import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assembleExport, EXPORT_EXCLUDED, EXPORT_TABLES, exportFileName } from "@/modules/export/tables";
import { formatBytes, GIB, MIB, usageLogLine, usageOf } from "@/modules/health/service";
import { csvCell, csvFile, csvLine } from "@/modules/payments/csv";
import { leadSearchQuery, paymentsQuery, recordBody, voidBody } from "@/modules/payments/schema";
import { formatUsd, isCalendarDate, isFutureDate, parseUsdToCents, plainUsd } from "@/modules/payments/service";
import { updateSettingsBody } from "@/modules/settings/schema";
import { AuthError } from "@/server/auth/actor";
import { handleHealth } from "@/server/edge/health";
// @ts-expect-error plain .mjs helper with no type declarations
import { backupImages, objectUrl, readManifest, sha256Of, summarise } from "../../scripts/lib/image-backup.mjs";
import { changesFrom, formFromValues } from "@/components/admin/settings-panel";

describe("S9: money", () => {
  it.each([
    ["1500", 150000],
    ["1500.5", 150050],
    ["1,500.50", 150050],
    ["0.01", 1],
    ["  12.30 ", 1230],
    ["100000000", 10000000000],
  ])("reads %j as %i cents", (text, cents) => expect(parseUsdToCents(text)).toBe(cents));

  it.each(["", "0", "0.00", "-1", "+1", "1.234", "1e3", "abc", "$5", "1,5", "1,50.00", ".5", "5.", "1 000", "100000000.01", "1,000,000,000.00"])("refuses %j", (text) =>
    expect(parseUsdToCents(text)).toBeNull(),
  );

  it("formats cents back without a float", () => {
    expect(formatUsd(150050)).toBe("1,500.50");
    expect(formatUsd(5)).toBe("0.05");
    expect(formatUsd(0)).toBe("0.00");
    expect(plainUsd(150050)).toBe("1500.50");
    expect(plainUsd(7)).toBe("0.07");
    // 0.1 + 0.2 style sums stay exact because the sum is of integers.
    expect(formatUsd(10 + 20)).toBe("0.30");
  });

  it("accepts only real calendar dates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("26-10-01")).toBe(false);
    expect(isCalendarDate("2026-10-1")).toBe(false);
  });

  it("calls a date future by the WAT calendar day", () => {
    expect(isFutureDate("2026-10-26", new Date("2026-10-26T12:00:00Z"))).toBe(false);
    expect(isFutureDate("2026-10-27", new Date("2026-10-26T12:00:00Z"))).toBe(true);
    expect(isFutureDate("2026-10-27", new Date("2026-10-26T23:00:00Z"))).toBe(false); // already the 27th in Douala
    expect(isFutureDate("2026-10-27", new Date("2026-10-26T22:59:59Z"))).toBe(true);
  });
});

describe("S9.2: CSV cells", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=1", "'\t=1"],
    ["plain", "plain"],
    ["a=b", "a=b"],
    ["", ""],
  ])("writes %j as %j", (value, cell) => expect(csvCell(value)).toBe(cell));

  it("quotes commas, quotes and line breaks, after the formula guard", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
    expect(csvCell("=A,B")).toBe('"\'=A,B"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("starts the file with a byte order mark and ends every line with CRLF", () => {
    const file = csvFile(["a", "b"], [["1", "=2"]]);
    expect(file).toBe("﻿a,b\r\n1,'=2\r\n");
    expect(csvLine(["x"])).toBe("x");
  });
});

describe("S9: request shapes", () => {
  const good = { submissionToken: "0194a000-0000-7000-8000-000000000001", universityId: "0194a000-0000-7000-8000-000000000002", amount: "10", receivedOn: "2026-10-01" };
  it("accepts a minimal record and refuses unknown fields, a bad token, a bad amount or date, a long note", () => {
    expect(recordBody.safeParse(good).success).toBe(true);
    expect(recordBody.safeParse({ ...good, leadId: null, note: null }).success).toBe(true);
    for (const bad of [{ ...good, extra: 1 }, { ...good, submissionToken: "x" }, { ...good, amount: "0" }, { ...good, receivedOn: "2026-02-30" }, { ...good, note: "n".repeat(501) }, { ...good, amount: 10 }]) {
      expect(recordBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("needs a reason to void", () => {
    const id = "0194a000-0000-7000-8000-000000000003";
    expect(voidBody.safeParse({ id, reason: "typo" }).success).toBe(true);
    for (const bad of [{ id }, { id, reason: "  " }, { id, reason: "r".repeat(301) }, { id, reason: "x", more: 1 }]) expect(voidBody.safeParse(bad).success).toBe(false);
  });
  it("parses the screen's query and defaults the status to all", () => {
    expect(paymentsQuery.parse({})).toEqual({ status: "all" });
    expect(paymentsQuery.safeParse({ status: "voided", from: "2026-01-01" }).success).toBe(true);
    expect(paymentsQuery.safeParse({ status: "x" }).success).toBe(false);
    expect(leadSearchQuery.safeParse({ q: "a" }).success).toBe(false);
    expect(leadSearchQuery.safeParse({ q: " ab " }).success).toBe(true);
  });
});

describe("S10.1: settings schema and the form", () => {
  it("cleans a typed number, and holds every limit", () => {
    const parsed = updateSettingsBody.parse({ changes: { whatsapp_number_e164: "+44 (7700) 900-123" } });
    expect(parsed.changes.whatsapp_number_e164).toBe("+447700900123");
    expect(updateSettingsBody.safeParse({ changes: { pipeline_freshness_days: null } }).success).toBe(true);
    expect(updateSettingsBody.safeParse({ changes: {} }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ changes: { timezone: "UTC" } }).success).toBe(false);
  });

  const values = { whatsapp_number_e164: "+447700900123", contact_phone_display: "+44 7700 900123", sla_weekday_hours: 4, sla_weekend_hours: 24, stale_fee_days: 180, stale_tour_days: 90, pipeline_freshness_days: null, media_budget_bytes: 3758096384, collect_page_views: true };

  it("shows the stored values as text, the budget in MiB, and 'not set' as empty", () => {
    expect(formFromValues(values)).toMatchObject({ slaWeekday: "4", freshness: "", budgetMib: "3584", collect: true });
  });
  it("sends only what changed", () => {
    const form = formFromValues(values);
    expect(changesFrom(values, form)).toEqual({});
    expect(changesFrom(values, { ...form, slaWeekday: "6", collect: false, freshness: "14", budgetMib: "200" })).toEqual({
      sla_weekday_hours: 6,
      collect_page_views: false,
      pipeline_freshness_days: 14,
      media_budget_bytes: 200 * 1024 * 1024,
    });
  });
  it("sends text it cannot read as a number as it is typed, so the server names the field", () => {
    expect(changesFrom(values, { ...formFromValues(values), staleFee: "abc" })).toEqual({ stale_fee_days: "abc" });
    expect(changesFrom({ ...values, pipeline_freshness_days: 14 }, { ...formFromValues({ ...values, pipeline_freshness_days: 14 }), freshness: "" })).toEqual({ pipeline_freshness_days: null });
  });
});

describe("S10.2: usage levels", () => {
  it("warns from 70% and is urgent from 90%", () => {
    expect(usageOf(69, 100).level).toBe("ok");
    expect(usageOf(70, 100).level).toBe("warn");
    expect(usageOf(89, 100).level).toBe("warn");
    expect(usageOf(90, 100).level).toBe("urgent");
    expect(usageOf(150, 100).level).toBe("urgent");
    expect(usageOf(0, 100).ratio).toBe(0);
  });
  it("copes with a zero budget without producing Infinity", () => {
    expect(Number.isFinite(usageOf(5, 0).ratio)).toBe(true);
    expect(usageOf(5, 0).level).toBe("urgent");
    expect(usageOf(0, 0).level).toBe("ok");
  });
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(512 * MIB)).toBe("512 MiB");
    expect(formatBytes(3.5 * GIB)).toBe("3.5 GiB");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
  it("writes a log line with sizes and levels only", () => {
    const line = JSON.parse(usageLogLine(usageOf(80, 100), usageOf(10, 100))) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "warn", job: "usage", status: "warn", databasePercent: 80, imagePercent: 10 });
    expect(JSON.parse(usageLogLine(usageOf(1, 100), usageOf(1, 100)))).toMatchObject({ level: "info", status: "ok" });
  });
});

describe("S10.2: GET /api/v1/health", () => {
  const admin = () => Promise.resolve({} as never);
  const request = (query = "", cookie = false) => new Request(`https://example.test/api/v1/health${query}`, cookie ? { headers: { cookie: "x=1" } } : {});

  it("answers ok without touching the session or the database", async () => {
    const ping = vi.fn();
    const requireAdmin = vi.fn();
    const response = await handleHealth(request(), { version: "v1", requireAdmin, pingDatabase: ping });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version: "v1" });
    expect(ping).not.toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
  });
  it("the deep check needs an admin", async () => {
    const ping = vi.fn();
    const none = await handleHealth(request("?deep=1"), { version: "v", requireAdmin: () => Promise.reject(new AuthError("UNAUTHENTICATED", "no")), pingDatabase: ping });
    const student = await handleHealth(request("?deep=1"), { version: "v", requireAdmin: () => Promise.reject(new AuthError("FORBIDDEN", "no")), pingDatabase: ping });
    expect([none.status, student.status]).toEqual([401, 403]);
    expect(ping).not.toHaveBeenCalled();
  });
  it("the deep check reports the database, ok or down", async () => {
    const ok = await handleHealth(request("?deep=1"), { version: "v", requireAdmin: admin, pingDatabase: () => Promise.resolve() });
    expect(await ok.json()).toEqual({ status: "ok", version: "v", database: "ok" });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const down = await handleHealth(request("?deep=1"), { version: "v", requireAdmin: admin, pingDatabase: () => Promise.reject(new Error("password=secret")) });
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ status: "degraded", version: "v", database: "unreachable" });
    expect(String(error.mock.calls[0]?.[0])).not.toContain("secret");
    error.mockRestore();
  });
  it("a failure of the session lookup itself is a 503 to retry, not a 403", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleHealth(request("?deep=1"), { version: "v", requireAdmin: () => Promise.reject(new Error("neon asleep")), pingDatabase: vi.fn() });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    error.mockRestore();
  });
});

describe("S10.3: export file", () => {
  it("builds one valid JSON document from per-table texts without parsing them", () => {
    const text = assembleExport("2026-10-26T12:00:00.000Z", { lead: '[{"id":1}]', faq: "[]" });
    expect(JSON.parse(text)).toEqual({ format: "scollarly-export-v1", exportedAt: "2026-10-26T12:00:00.000Z", imageBytesIncluded: false, tables: { lead: [{ id: 1 }], faq: [] } });
    expect(exportFileName("2026-10-26")).toBe("scollarly-export-2026-10-26.json");
  });
  it("lists no table twice and keeps secrets out", () => {
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
    expect(Object.keys(EXPORT_EXCLUDED).sort()).toEqual(["admin_invite", "owner_totp", "recovery_code", "step_up"]);
  });
});

describe("S10.3: scripts/backup-images.mjs", () => {
  const bytesA = new TextEncoder().encode("picture A");
  const bytesB = new TextEncoder().encode("picture B");
  const hashA = sha256Of(bytesA) as string;
  const hashB = sha256Of(bytesB) as string;
  const base = "https://storage.example.test/images";

  it("reads the manifest from the full export, a list of rows, or one hash per line, and refuses anything else", () => {
    expect(readManifest(JSON.stringify({ tables: { media_asset: [{ sha256: hashA }, { sha256: hashB }, { sha256: hashA }] } }))).toEqual([hashA, hashB]);
    expect(readManifest(JSON.stringify([{ sha256: hashA }]))).toEqual([hashA]);
    expect(readManifest(`${hashA}\r\n\r\n${hashB}\n`)).toEqual([hashA, hashB]);
    expect(readManifest("﻿" + hashA)).toEqual([hashA]);
    for (const bad of ["", "   ", "{not json", "{}", JSON.stringify({ tables: {} }), "abc", JSON.stringify([{ sha256: "nope" }])]) expect(() => readManifest(bad), bad).toThrow();
  });
  it("builds the object address and refuses plain http", () => {
    expect(objectUrl(base + "/", hashA)).toBe(`${base}/${hashA}.webp`);
    expect(() => objectUrl("http://storage.example.test/images", hashA)).toThrow(/https/);
    expect(() => objectUrl("not a url", hashA)).toThrow();
  });

  async function inFolder<T>(work: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "images-"));
    try {
      return await work(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const store = (objects: Record<string, Uint8Array | number>): typeof fetch =>
    (async (input: string | URL | Request) => {
      const hash = String(input).split("/").pop()!.replace(".webp", "");
      const object = objects[hash];
      if (object === undefined) return new Response("no", { status: 404 });
      if (typeof object === "number") return new Response("err", { status: object });
      return new Response(object as unknown as BodyInit);
    }) as typeof fetch;

  it("downloads what is missing, keeps what is right, replaces a damaged copy, and writes only bytes that match their name", async () => {
    await inFolder(async (dir) => {
      await writeFile(join(dir, `${hashB}.webp`), "damaged");
      const result = await backupImages({ hashes: [hashA, hashB], baseUrl: base, out: dir, fetchImpl: store({ [hashA]: bytesA, [hashB]: bytesB }) });
      expect(result).toMatchObject({ total: 2, kept: 0, downloaded: 2, replacedCorrupt: [hashB], missingRemote: [], corruptRemote: [], failed: [] });
      expect(createHash("sha256").update(await readFile(join(dir, `${hashB}.webp`))).digest("hex")).toBe(hashB);
      // A second run has nothing to do.
      const again = await backupImages({ hashes: [hashA, hashB], baseUrl: base, out: dir, fetchImpl: store({}) });
      expect(again).toMatchObject({ kept: 2, downloaded: 0 });
      expect(summarise(again).exitCode).toBe(0);
    });
  });
  it("reports a missing object, a corrupt object and a server error, writes nothing for them, and exits 1", async () => {
    await inFolder(async (dir) => {
      const hashC = sha256Of(new TextEncoder().encode("C")) as string;
      const result = await backupImages({ hashes: [hashA, hashB, hashC], baseUrl: base, out: dir, fetchImpl: store({ [hashA]: new TextEncoder().encode("not A"), [hashC]: 500 }) });
      expect(result.missingRemote).toEqual([hashB]);
      expect(result.corruptRemote).toEqual([hashA]);
      expect(result.failed).toEqual([hashC]);
      expect(await readdir(dir)).toEqual([]);
      const summary = summarise(result);
      expect(summary.exitCode).toBe(1);
      expect(summary.lines.join("\n")).toContain("MISSING in the bucket: 1");
    });
  });
  it("does not trust a damaged copy that could not be fetched again", async () => {
    await inFolder(async (dir) => {
      await writeFile(join(dir, `${hashA}.webp`), "damaged");
      const result = await backupImages({ hashes: [hashA], baseUrl: base, out: dir, fetchImpl: store({}) });
      expect(result.missingRemote).toEqual([hashA]);
      expect(await readdir(dir)).toEqual([]);
    });
  });
  it("survives a network failure and leaves pictures that are not in the manifest alone", async () => {
    await inFolder(async (dir) => {
      await writeFile(join(dir, `${hashB}.webp`), bytesB);
      const down = (async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch;
      const result = await backupImages({ hashes: [hashA], baseUrl: base, out: dir, fetchImpl: down });
      expect(result.failed).toEqual([hashA]);
      expect(result.extraLocal).toEqual([hashB]);
      expect(await readdir(dir)).toEqual([`${hashB}.webp`]);
    });
  });
  it("--fast keeps a file without hashing it", async () => {
    await inFolder(async (dir) => {
      await writeFile(join(dir, `${hashA}.webp`), "whatever");
      const result = await backupImages({ hashes: [hashA], baseUrl: base, out: dir, fetchImpl: store({}), verifyExisting: false });
      expect(result).toMatchObject({ kept: 1, replacedCorrupt: [] });
    });
  });
});
