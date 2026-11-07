import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/constants";
import { api as realApi, type ApiResult } from "./api";

/**
 * The phone's side of a document upload (S17.1; architecture 24.5): ask the Worker for a short link, send the file straight to private
 * storage, then ask the Worker to check it. Each document is its own upload, so one that fails is tried again alone, with the file still in
 * hand; nothing is kept on the device (the file is read only while it is being sent). Never throws: every way it can fail is a `reason` the
 * screen turns into words.
 */

export type UploadReason =
  /** Checked before anything is sent. */
  | "EMPTY"
  | "TOO_LARGE"
  | "WRONG_TYPE"
  /** The phone is offline, or the request never reached the server or the storage. */
  | "NETWORK"
  | "SIGN_IN"
  | "ALREADY_APPROVED"
  /** The storage refused the file (the link ran out, or the file is not what was announced). */
  | "SEND_FAILED"
  /** The Worker looked at the file and it did not pass. */
  | "MISSING"
  | "TYPE_DIFFERS"
  | "SIZE_DIFFERS"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type UploadOutcome = { ok: true; id: string } | { ok: false; reason: UploadReason; /** Where it stopped, so a retry can say what is being redone. */ step: "check" | "sign" | "send" | "confirm" };

export interface UploadDeps {
  api: <T>(method: "GET" | "POST", path: string, body?: unknown) => Promise<ApiResult<T>>;
  /** Sends the file to the signed address. Resolves with the HTTP status, or 0 when the request never arrived. */
  put: (url: string, headers: Record<string, string>, file: Blob) => Promise<number>;
}

export const realDeps: UploadDeps = {
  api: realApi,
  put: async (url, headers, file) => {
    try {
      return (await fetch(url, { method: "PUT", headers, body: file })).status;
    } catch {
      return 0;
    }
  },
};

/** The type to announce: what the browser says, and failing that what the extension says (some phones leave it blank). */
export function contentTypeOf(file: { type: string; name: string }): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop();
  return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "";
}

/** The checks that need no network: a file with something in it, up to 5 MB, of an allowed type. Null when it is fine. */
export function checkBeforeSend(file: { size: number; type: string; name: string }): UploadReason | null {
  if (file.size <= 0) return "EMPTY";
  if (file.size > MAX_DOCUMENT_BYTES) return "TOO_LARGE";
  return (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentTypeOf(file)) ? null : "WRONG_TYPE";
}

const CONFIRM_REASONS: Record<string, UploadReason> = { MISSING: "MISSING", TYPE_DIFFERS: "TYPE_DIFFERS", SIZE_DIFFERS: "SIZE_DIFFERS", EMPTY: "EMPTY", TOO_LARGE: "TOO_LARGE" };

function failure(result: { status: number; code: string; fields: Record<string, string> }, step: "sign" | "confirm"): UploadReason {
  if (result.status === 0) return "NETWORK";
  if (result.status === 401) return "SIGN_IN";
  if (result.status === 503) return "UNAVAILABLE";
  if (result.code === "CONFLICT" && result.fields.kind === "ALREADY_APPROVED") return "ALREADY_APPROVED";
  if (step === "confirm" && result.fields.file) return CONFIRM_REASONS[result.fields.file] ?? "UNKNOWN";
  if (result.fields.byteSize === "TOO_LARGE") return "TOO_LARGE";
  if (result.fields.contentType) return "WRONG_TYPE";
  return "UNKNOWN";
}

/**
 * `signPath` and `confirmPath` are the pair for a student (`me/documents.sign`, `me/documents.confirm`) or for the admin's letters; `signBody` is
 * what the first call needs besides the size and type, which this function adds.
 */
export async function uploadDocument(
  file: File | (Blob & { name: string }),
  signBody: Record<string, unknown>,
  deps: UploadDeps = realDeps,
  paths: { sign: string; confirm: string } = { sign: "/api/v1/me/documents.sign", confirm: "/api/v1/me/documents.confirm" },
): Promise<UploadOutcome> {
  const problem = checkBeforeSend(file);
  if (problem) return { ok: false, reason: problem, step: "check" };

  const signed = await deps.api<{ id: string; url: string; headers: Record<string, string> }>("POST", paths.sign, { ...signBody, contentType: contentTypeOf(file), byteSize: file.size });
  if (!signed.ok) return { ok: false, reason: failure(signed, "sign"), step: "sign" };

  const status = await deps.put(signed.data.url, signed.data.headers, file);
  if (status === 0) return { ok: false, reason: "NETWORK", step: "send" };
  if (status < 200 || status >= 300) return { ok: false, reason: "SEND_FAILED", step: "send" };

  const confirmed = await deps.api<{ id: string; state: string }>("POST", paths.confirm, { id: signed.data.id });
  if (!confirmed.ok) return { ok: false, reason: failure(confirmed, "confirm"), step: "confirm" };
  return { ok: true, id: signed.data.id };
}
