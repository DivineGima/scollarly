import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { inContext } from "@/server/db/rls";
import { findAssetBySha256Query, insertMediaAssetQuery } from "@/server/repositories/media";
import { selectOne, transactionRoundTrip } from "@/server/repositories/phase0-probe";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const OWNER_CTX = { userId: null, role: "owner" as const };
const addAppUser = (id: string, role = "student") => t.run(`insert into app_user (id, role) values ('${id}', '${role}')`);

describe("S0.1/S0.3: migrations and the two query paths", () => {
  it("applies the committed migrations to an empty database", async () => {
    const tables = (await t.run("select table_name from information_schema.tables where table_schema = 'public' order by 1")) as { table_name: string }[];
    // Stage 1 (S1.1) adds the rest of architecture 7; the every-table list is asserted in schema-foundation.test.ts.
    expect(tables.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["app_user", "media_asset", "owner_totp", "recovery_code", "step_up"]),
    );
  });

  it("no longer has the self-hosted Better Auth tables or the bytea image table (ADR-037, ADR-039)", async () => {
    const tables = (await t.run("select table_name from information_schema.tables where table_schema = 'public'")) as { table_name: string }[];
    for (const gone of ["user", "session", "account", "verification", "two_factor", "media_blob"]) expect(tables.map((r) => r.table_name)).not.toContain(gone);
  });

  it("runs a plain query and a transaction through the repository layer", async () => {
    expect(await selectOne(t.db)).toBe(1);
    expect(await transactionRoundTrip(t.db)).toBe(2);
  });
});

describe("S0.4: one owner, enforced by the database (ADR-013)", () => {
  it("allows exactly one owner and refuses a second at the database", async () => {
    await addAppUser("owner-a", "owner");
    await addAppUser("owner-b");
    await expect(t.run(`update app_user set role = 'owner' where id = 'owner-b'`)).rejects.toThrow();
    const rows = (await t.run(`select count(*)::int as n from app_user where role = 'owner'`)) as { n: number }[];
    expect(rows[0]?.n).toBe(1);
  });

  it("is not defeated by a direct insert", async () => {
    await expect(addAppUser("owner-c", "owner")).rejects.toThrow();
  });

  it("allows many admins and students (the index covers only the owner role)", async () => {
    for (const [id, role] of [["admin-1", "admin"], ["admin-2", "admin"], ["student-1", "student"], ["student-2", "student"]] as const) await addAppUser(id, role);
    const rows = (await t.run(`select count(*)::int as n from app_user where role in ('admin','student')`)) as { n: number }[];
    expect(rows[0]?.n).toBeGreaterThanOrEqual(5);
  });

  it("refuses a role outside student/admin/owner", async () => {
    await expect(addAppUser("root-1", "superuser")).rejects.toThrow();
  });
});

describe("S0.5: image metadata (the bytes live in Neon Object Storage)", () => {
  const asset = async (seed: number, over: Partial<Parameters<typeof insertMediaAssetQuery>[1]> = {}) => {
    const data = new Uint8Array([seed, seed, seed, seed]);
    return { id: randomUUID(), kind: "photo" as const, width: 1200, height: 800, bytes: data.byteLength, sha256: await sha256Hex(data), ...over };
  };

  it("stores one row per image and finds it by content hash", async () => {
    const a = await asset(1);
    const [inserted] = await inContext(t.db, OWNER_CTX, insertMediaAssetQuery(t.db, a));
    expect(inserted).toHaveLength(1);
    const [found] = await inContext(t.db, OWNER_CTX, findAssetBySha256Query(t.db, a.sha256));
    expect(found[0]).toMatchObject({ sha256: a.sha256, width: 1200, height: 800, bytes: 4 });
  });

  it("deduplicates by content hash (a second upload stores nothing new)", async () => {
    const a = await asset(2);
    const [first] = await inContext(t.db, OWNER_CTX, insertMediaAssetQuery(t.db, a));
    const [second] = await inContext(t.db, OWNER_CTX, insertMediaAssetQuery(t.db, { ...a, id: randomUUID() }));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("does not find an archived asset, or an unknown hash", async () => {
    const a = await asset(3);
    await inContext(t.db, OWNER_CTX, insertMediaAssetQuery(t.db, a));
    await t.run(`update media_asset set archived_at = now() where sha256 = '${a.sha256}'`);
    expect((await inContext(t.db, OWNER_CTX, findAssetBySha256Query(t.db, a.sha256)))[0]).toHaveLength(0);
    expect((await inContext(t.db, OWNER_CTX, findAssetBySha256Query(t.db, "f".repeat(64))))[0]).toHaveLength(0);
  });

  it("only accepts image/webp and known kinds at the database", async () => {
    await expect(t.run(`insert into media_asset (id, kind, width, height, bytes, mime, sha256) values ('${randomUUID()}', 'photo', 1, 1, 1, 'image/svg+xml', '${"b".repeat(64)}')`)).rejects.toThrow();
    await expect(t.run(`insert into media_asset (id, kind, width, height, bytes, mime, sha256) values ('${randomUUID()}', 'video', 1, 1, 1, 'image/webp', '${"c".repeat(64)}')`)).rejects.toThrow();
  });
});
