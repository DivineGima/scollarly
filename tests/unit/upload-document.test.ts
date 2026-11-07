import { describe, expect, it } from "vitest";
import type { ApiResult } from "@/lib/client/api";
import { checkBeforeSend, contentTypeOf, uploadDocument, type UploadDeps } from "@/lib/client/upload-document";

/** Only size, type and name are read before the file is handed to `put`, so a plain object stands in for the browser's File. */
const file = (size: number, type = "image/png", name = "id.png") => ({ size, type, name }) as unknown as File;

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (status: number, code: string, fields: Record<string, string> = {}): ApiResult<never> => ({ ok: false, status, code, fields, retryAfter: null });

function deps(script: { sign?: ApiResult<unknown>; put?: number; confirm?: ApiResult<unknown> }) {
  const calls: string[] = [];
  const d: UploadDeps = {
    api: (async (_method: string, path: string) => {
      calls.push(path.split("/").pop() as string);
      return path.endsWith("sign") || path.endsWith("documents.sign") ? (script.sign ?? ok({ id: "d1", url: "https://storage.test/x", headers: { "content-type": "image/png" } })) : (script.confirm ?? ok({ id: "d1", state: "uploaded" }));
    }) as UploadDeps["api"],
    put: async () => {
      calls.push("put");
      return script.put ?? 200;
    },
  };
  return { d, calls };
}

describe("checkBeforeSend", () => {
  it("accepts JPG, PNG and PDF up to 5 MB and nothing else", () => {
    expect(checkBeforeSend(file(1000, "image/jpeg", "a.jpg"))).toBeNull();
    expect(checkBeforeSend(file(1000, "application/pdf", "a.pdf"))).toBeNull();
    expect(checkBeforeSend(file(5 * 1024 * 1024))).toBeNull();
    expect(checkBeforeSend(file(5 * 1024 * 1024 + 1))).toBe("TOO_LARGE");
    expect(checkBeforeSend(file(0))).toBe("EMPTY");
    expect(checkBeforeSend(file(1000, "image/heic", "a.heic"))).toBe("WRONG_TYPE");
    expect(checkBeforeSend(file(1000, "image/gif", "a.gif"))).toBe("WRONG_TYPE");
  });

  it("reads the type from the extension when the phone leaves it blank", () => {
    expect(contentTypeOf({ type: "", name: "Scan.PDF" })).toBe("application/pdf");
    expect(contentTypeOf({ type: "", name: "photo.jpeg" })).toBe("image/jpeg");
    expect(contentTypeOf({ type: "", name: "notes.txt" })).toBe("");
  });
});

describe("uploadDocument", () => {
  it("signs, sends, then confirms, in that order", async () => {
    const { d, calls } = deps({});
    expect(await uploadDocument(file(100), { kind: "id" }, d)).toEqual({ ok: true, id: "d1" });
    expect(calls).toEqual(["documents.sign", "put", "documents.confirm"]);
  });

  it("sends nothing for a file that fails the local check", async () => {
    const { d, calls } = deps({});
    expect(await uploadDocument(file(6 * 1024 * 1024), { kind: "id" }, d)).toEqual({ ok: false, reason: "TOO_LARGE", step: "check" });
    expect(calls).toEqual([]);
  });

  it("says offline when the link cannot be asked for, and when the file cannot be sent", async () => {
    expect(await uploadDocument(file(100), { kind: "id" }, deps({ sign: fail(0, "NETWORK") }).d)).toEqual({ ok: false, reason: "NETWORK", step: "sign" });
    const sent = deps({ put: 0 });
    expect(await uploadDocument(file(100), { kind: "id" }, sent.d)).toEqual({ ok: false, reason: "NETWORK", step: "send" });
    expect(sent.calls).toEqual(["documents.sign", "put"]); // nothing is confirmed for a file that did not arrive
  });

  it("says the storage refused the file when the link was refused, and does not confirm", async () => {
    const { d, calls } = deps({ put: 403 });
    expect(await uploadDocument(file(100), { kind: "id" }, d)).toEqual({ ok: false, reason: "SEND_FAILED", step: "send" });
    expect(calls).not.toContain("documents.confirm");
  });

  it("tells apart what the Worker found wrong with the file", async () => {
    for (const [token, reason] of [["TYPE_DIFFERS", "TYPE_DIFFERS"], ["SIZE_DIFFERS", "SIZE_DIFFERS"], ["MISSING", "MISSING"]] as const) {
      const outcome = await uploadDocument(file(100), { kind: "id" }, deps({ confirm: fail(token === "MISSING" ? 409 : 400, token === "MISSING" ? "CONFLICT" : "VALIDATION", { file: token }) }).d);
      expect(outcome).toEqual({ ok: false, reason, step: "confirm" });
    }
  });

  it("maps an expired sign-in, an approved document and a store that is down", async () => {
    expect((await uploadDocument(file(100), { kind: "id" }, deps({ sign: fail(401, "UNAUTHENTICATED") }).d)).ok).toBe(false);
    expect(await uploadDocument(file(100), { kind: "id" }, deps({ sign: fail(401, "UNAUTHENTICATED") }).d)).toMatchObject({ reason: "SIGN_IN" });
    expect(await uploadDocument(file(100), { kind: "id" }, deps({ sign: fail(409, "CONFLICT", { kind: "ALREADY_APPROVED" }) }).d)).toMatchObject({ reason: "ALREADY_APPROVED" });
    expect(await uploadDocument(file(100), { kind: "id" }, deps({ sign: fail(503, "TEMPORARILY_UNAVAILABLE") }).d)).toMatchObject({ reason: "UNAVAILABLE" });
  });

  it("a retry with the same file starts again from the link, so only that document is redone", async () => {
    const f = file(100);
    const first = deps({ put: 0 });
    expect(await uploadDocument(f, { kind: "id" }, first.d)).toMatchObject({ ok: false, step: "send" });
    const second = deps({});
    expect(await uploadDocument(f, { kind: "id" }, second.d)).toEqual({ ok: true, id: "d1" });
    expect(second.calls).toEqual(["documents.sign", "put", "documents.confirm"]);
  });
});
