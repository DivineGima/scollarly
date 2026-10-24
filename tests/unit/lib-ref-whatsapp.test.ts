import { describe, expect, it } from "vitest";
import { formatRef, generateRef, parseRef, REF_ALPHABET, REF_PATTERN } from "@/lib/ref";
import { buildWhatsAppUrl, whatsAppDigits } from "@/lib/whatsapp";

describe("generateRef (ADR-006)", () => {
  it("is SC- and two groups of five Crockford base32 characters", () => {
    for (let i = 0; i < 2000; i++) expect(generateRef()).toMatch(REF_PATTERN);
  });

  it("maps random bytes to the alphabet with a 5-bit mask, so every symbol is equally likely", () => {
    expect(generateRef(() => new Uint8Array(10))).toBe("SC-00000-00000");
    expect(generateRef(() => new Uint8Array(10).fill(255))).toBe("SC-ZZZZZ-ZZZZZ");
    expect(generateRef(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe("SC-01234-56789");
    // 32 and 64 and 96 all mask to symbol 0.
    expect(generateRef(() => Uint8Array.from([32, 64, 96, 128, 160, 192, 224, 33, 65, 97]))).toBe("SC-00000-00111");
  });

  it("uses all 32 symbols and never I, L, O or U", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) for (const c of generateRef().replace(/^SC-/, "").replace("-", "")) seen.add(c);
    expect([...seen].sort().join("")).toBe([...REF_ALPHABET].sort().join(""));
    for (const c of "ILOU") expect(seen.has(c)).toBe(false);
  });

  it("does not repeat in a large sample (50 bits)", () => {
    const refs = new Set(Array.from({ length: 20000 }, () => generateRef()));
    expect(refs.size).toBe(20000);
  });

  it("refuses too few random bytes", () => {
    expect(() => generateRef(() => new Uint8Array(3))).toThrow(RangeError);
  });
});

describe("formatRef", () => {
  it("groups ten characters and refuses anything else", () => {
    expect(formatRef("ABCDEFGHJK")).toBe("SC-ABCDE-FGHJK");
    expect(() => formatRef("ABCDEFGHJ")).toThrow(RangeError);
    expect(() => formatRef("ABCDEFGHIK")).toThrow(RangeError); // I
    expect(() => formatRef("abcdefghjk")).toThrow(RangeError);
  });
});

describe("parseRef: what a student types or pastes", () => {
  it("accepts the canonical form in any case, with spaces, dashes or no prefix", () => {
    for (const typed of ["SC-ABCDE-FGHJK", "sc-abcde-fghjk", "SC ABCDE FGHJK", "SCABCDEFGHJK", "ABCDEFGHJK", " abcde-fghjk ", "SC–ABCDE–FGHJK"]) {
      expect(parseRef(typed), typed).toBe("SC-ABCDE-FGHJK");
    }
  });

  it("applies Crockford's reading rules: O is 0, I and L are 1", () => {
    expect(parseRef("0O0O0O0O0O")).toBe("SC-00000-00000");
    expect(parseRef("ILILILILIL")).toBe("SC-11111-11111");
    expect(parseRef("sc-oilbo-0000z")).toBe("SC-011B0-0000Z");
  });

  it("refuses the wrong length, U and other symbols", () => {
    for (const typed of ["", "SC-ABCDE", "SC-ABCDE-FGHJKM", "SC-ABCDE-FGHJU", "ABCDEFGHJKMN", "SC-ABCD!-FGHJK"]) {
      expect(parseRef(typed), typed).toBeNull();
    }
  });

  it("round-trips a generated reference", () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateRef();
      expect(parseRef(ref)).toBe(ref);
      expect(parseRef(ref.toLowerCase().replace(/-/g, " "))).toBe(ref);
    }
  });
});

describe("buildWhatsAppUrl (FR-4)", () => {
  it("builds the link from the configured number and encodes the text with encodeURIComponent", () => {
    expect(buildWhatsAppUrl("+237651232301")).toBe("https://wa.me/237651232301");
    expect(buildWhatsAppUrl("+237651232301", "Hello & welcome, SC-ABCDE-FGHJK")).toBe(
      `https://wa.me/237651232301?text=${encodeURIComponent("Hello & welcome, SC-ABCDE-FGHJK")}`,
    );
    expect(buildWhatsAppUrl("+237651232301", "a b\nc?d=e#f")).toBe("https://wa.me/237651232301?text=a%20b%0Ac%3Fd%3De%23f");
  });

  it("encodes non-ASCII text and keeps no raw spaces, ampersands or hashes", () => {
    const url = buildWhatsAppUrl("+919815725968", "Bonjour, étudiant ✓ & co #1") ?? "";
    expect(url).toContain("text=");
    const text = url.split("text=")[1] ?? "";
    expect(text).not.toMatch(/[ &#]/);
    expect(decodeURIComponent(text)).toBe("Bonjour, étudiant ✓ & co #1");
  });

  it("omits the text parameter for an empty message", () => {
    expect(buildWhatsAppUrl("+237651232301", "")).toBe("https://wa.me/237651232301");
  });

  it("returns null, never a broken link, when no valid number is configured", () => {
    for (const value of [null, undefined, "", "651232301", "+0237651232301", "237651232301", "+237 651 232 301"]) {
      expect(buildWhatsAppUrl(value, "Hi"), String(value)).toBeNull();
    }
  });

  it("whatsAppDigits drops the plus", () => {
    expect(whatsAppDigits("+237651232301")).toBe("237651232301");
    expect(whatsAppDigits(null)).toBeNull();
  });
});
