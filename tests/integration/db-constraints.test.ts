import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { countOwners, promoteToOwner, readPhase0Title, selectOne, transactionRoundTrip, writePhase0Title } from "@/server/repositories/phase0-probe";
import { findBlobBySha256, insertMedia } from "@/server/repositories/media";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const addUser = (id: string, role = "student") =>
  t.run(`insert into "user" (id, name, email, role) values ('${id}', 'Test ${id}', '${id}@example.test', '${role}')`);

describe("S0.1/S0.3: migrations and the two query paths", () => {
  it("applies the committed migration to an empty database", async () => {
    const tables = (await t.run("select table_name from information_schema.tables where table_schema = 'public' order by 1")) as { table_name: string }[];
    expect(tables.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification", "two_factor", "media_asset", "media_blob", "phase0_lead_stub", "phase0_content"]),
    );
  });

  it("runs a plain query and a transaction through the repository layer", async () => {
    expect(await selectOne(t.db)).toBe(1);
    expect(await transactionRoundTrip(t.db)).toBe(2);
  });
});

describe("S0.4: one owner, enforced by the database (ADR-013)", () => {
  it("allows exactly one owner and refuses a second at the database", async () => {
    await addUser("owner-a");
    await addUser("owner-b");
    await promoteToOwner(t.db, "owner-a");
    expect(await countOwners(t.db)).toBe(1);
    await expect(promoteToOwner(t.db, "owner-b")).rejects.toThrow();
    expect(await countOwners(t.db)).toBe(1);
  });

  it("is not defeated by a direct insert", async () => {
    await expect(addUser("owner-c", "owner")).rejects.toThrow();
  });

  it("allows many admins and students (the index covers only the owner role)", async () => {
    await addUser("admin-1", "admin");
    await addUser("admin-2", "admin");
    await addUser("student-1");
    await addUser("student-2");
    const rows = (await t.run(`select count(*)::int as n from "user" where role in ('admin','student')`)) as { n: number }[];
    expect(rows[0]?.n).toBeGreaterThanOrEqual(4);
  });

  it("refuses a role outside student/admin/owner", async () => {
    await expect(addUser("root-1", "superuser")).rejects.toThrow();
  });

  it("treats emails as unique", async () => {
    await expect(t.run(`insert into "user" (id, name, email) values ('dup-1', 'Dup', 'owner-a@example.test')`)).rejects.toThrow();
  });
});

describe("S0.5: images in media_blob", () => {
  const png300k = () => Uint8Array.from({ length: 300 * 1024 }, (_, i) => (i * 31 + 7) % 256);

  it("stores 300 KB and reads back identical bytes (bytea round trip)", async () => {
    const data = png300k();
    const sha256 = await sha256Hex(data);
    expect(await insertMedia(t.db, { id: randomUUID(), kind: "photo", width: 1200, height: 800, sha256, data })).toBe(true);
    const found = await findBlobBySha256(t.db, sha256);
    expect(found).not.toBeNull();
    expect(found?.bytes).toBe(300 * 1024);
    expect(found?.mime).toBe("image/webp");
    expect(Buffer.compare(Buffer.from(found!.data), Buffer.from(data))).toBe(0);
  });

  it("deduplicates by content hash (a second upload stores nothing new)", async () => {
    const data = new Uint8Array([9, 9, 9, 9]);
    const sha256 = await sha256Hex(data);
    expect(await insertMedia(t.db, { id: randomUUID(), kind: "logo", width: 10, height: 10, sha256, data })).toBe(true);
    expect(await insertMedia(t.db, { id: randomUUID(), kind: "logo", width: 10, height: 10, sha256, data })).toBe(false);
    const rows = (await t.run(`select count(*)::int as n from media_asset where sha256 = '${sha256}'`)) as { n: number }[];
    expect(rows[0]?.n).toBe(1);
    const blobs = (await t.run(`select count(*)::int as n from media_blob b join media_asset a on a.id = b.media_id where a.sha256 = '${sha256}'`)) as { n: number }[];
    expect(blobs[0]?.n).toBe(1);
  });

  it("does not serve an archived asset, and returns null for an unknown hash", async () => {
    const data = new Uint8Array([5, 5, 5]);
    const sha256 = await sha256Hex(data);
    await insertMedia(t.db, { id: randomUUID(), kind: "other", width: 1, height: 1, sha256, data });
    await t.run(`update media_asset set archived_at = now() where sha256 = '${sha256}'`);
    expect(await findBlobBySha256(t.db, sha256)).toBeNull();
    expect(await findBlobBySha256(t.db, "f".repeat(64))).toBeNull();
  });

  it("only accepts image/webp and known kinds at the database", async () => {
    const id = randomUUID();
    await expect(t.run(`insert into media_asset (id, kind, width, height, bytes, mime, sha256) values ('${id}', 'photo', 1, 1, 1, 'image/svg+xml', '${"b".repeat(64)}')`)).rejects.toThrow();
    await expect(t.run(`insert into media_asset (id, kind, width, height, bytes, mime, sha256) values ('${randomUUID()}', 'video', 1, 1, 1, 'image/webp', '${"c".repeat(64)}')`)).rejects.toThrow();
  });

  it("refuses a blob that points at no asset", async () => {
    await expect(t.run(`insert into media_blob (media_id, data) values ('${randomUUID()}', '\\x00')`)).rejects.toThrow();
  });

  it("rolls the asset back if the blob insert fails (one transaction)", async () => {
    const sha256 = "d".repeat(64);
    const bad = { id: randomUUID(), kind: "photo" as const, width: 1, height: 1, sha256, data: null as unknown as Uint8Array };
    await expect(insertMedia(t.db, bad)).rejects.toThrow();
    const rows = (await t.run(`select count(*)::int as n from media_asset where sha256 = '${sha256}'`)) as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });
});

describe("S0.6: the content row behind tag revalidation", () => {
  it("returns null before anything is published, then the latest value", async () => {
    expect(await readPhase0Title(t.db)).toBeNull();
    await writePhase0Title(t.db, "First");
    expect(await readPhase0Title(t.db)).toBe("First");
    await writePhase0Title(t.db, "Second");
    expect(await readPhase0Title(t.db)).toBe("Second");
  });
});
