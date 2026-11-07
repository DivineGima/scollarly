import { describe, expect, it } from "vitest";
import { checkContent, isDocumentContentType, sniff } from "@/modules/documents/signature";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");

describe("sniff", () => {
  it("knows JPEG, PNG and PDF by their first bytes", () => {
    expect(sniff(JPEG)).toBe("image/jpeg");
    expect(sniff(PNG)).toBe("image/png");
    expect(sniff(PDF)).toBe("application/pdf");
  });

  it("refuses anything else, including HTML, an executable and a short read", () => {
    expect(sniff(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniff(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(sniff(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniff(new Uint8Array())).toBeNull();
  });
});

describe("isDocumentContentType", () => {
  it("allows exactly the three types", () => {
    expect(["image/jpeg", "image/png", "application/pdf"].every(isDocumentContentType)).toBe(true);
    expect(isDocumentContentType("image/gif")).toBe(false);
    expect(isDocumentContentType("text/html")).toBe(false);
  });
});

describe("checkContent", () => {
  const ok = { declaredType: "image/png", declaredSize: 1000, actualSize: 1000, head: PNG };

  it("accepts a file whose type and size match what was declared", () => {
    expect(checkContent(ok)).toEqual({ ok: true });
  });

  it("refuses an empty object and one over 5 MB (the boundary is 5 MB itself)", () => {
    expect(checkContent({ ...ok, actualSize: 0 })).toEqual({ ok: false, reason: "empty" });
    expect(checkContent({ ...ok, declaredSize: 5 * 1024 * 1024, actualSize: 5 * 1024 * 1024 })).toEqual({ ok: true });
    expect(checkContent({ ...ok, declaredSize: 5 * 1024 * 1024 + 1, actualSize: 5 * 1024 * 1024 + 1 })).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a file of another size than the one the link was signed for", () => {
    expect(checkContent({ ...ok, actualSize: 999 })).toEqual({ ok: false, reason: "size_differs" });
  });

  it("refuses a file whose bytes are not the declared type", () => {
    expect(checkContent({ ...ok, head: JPEG })).toEqual({ ok: false, reason: "type_differs" });
    expect(checkContent({ ...ok, head: new TextEncoder().encode("<html>") })).toEqual({ ok: false, reason: "type_differs" });
  });
});
