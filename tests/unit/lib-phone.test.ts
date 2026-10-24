import { describe, expect, it } from "vitest";
import { isE164, normalisePhone, PHONE_RULES } from "@/lib/phone";
import { unwrap } from "@/lib/result";

const good = (input: string, country?: string) => unwrap(normalisePhone(input, country));
const bad = (input: string, country?: string) => {
  const result = normalisePhone(input, country);
  if (result.ok) throw new Error(`expected a failure, got ${result.value.e164}`);
  return result.error;
};

describe("normalisePhone (ADR-025): the 7 student countries and India", () => {
  it("Cameroon: every way of typing the PRD's number gives the same E.164", () => {
    for (const typed of ["+237 651 232 301", "+237651232301", "00237 651 232 301", "237651232301", "651232301", "651 23 23 01", "(651) 232-301"]) {
      expect(good(typed, "CM"), typed).toEqual({ e164: "+237651232301", country: "CM", display: "+237 651 232 301" });
    }
  });

  it("Nigeria: drops the trunk 0, also when it is typed after the country code", () => {
    for (const typed of ["0803 123 4567", "803 123 4567", "+234 803 123 4567", "+234 (0)803 123 4567", "+2340803 123 4567", "2348031234567"]) {
      expect(good(typed, "NG"), typed).toEqual({ e164: "+2348031234567", country: "NG", display: "+234 803 123 4567" });
    }
  });

  it("Ghana", () => {
    expect(good("024 123 4567", "GH")).toEqual({ e164: "+233241234567", country: "GH", display: "+233 24 123 4567" });
    expect(good("+233 24 123 4567")).toMatchObject({ e164: "+233241234567", country: "GH" });
  });

  it("Ivory Coast: the leading 0 is part of the 10-digit number and is kept", () => {
    expect(good("07 08 09 12 34", "CI")).toEqual({ e164: "+2250708091234", country: "CI", display: "+225 07 08 09 12 34" });
    expect(good("+225 07 08 09 12 34")).toMatchObject({ e164: "+2250708091234", country: "CI" });
    expect(bad("08 09 12 34", "CI")).toBe("INVALID_LENGTH");
  });

  it("Senegal and Guinea", () => {
    expect(good("77 123 45 67", "SN")).toEqual({ e164: "+221771234567", country: "SN", display: "+221 77 123 45 67" });
    expect(good("622 12 34 56", "GN")).toEqual({ e164: "+224622123456", country: "GN", display: "+224 622 12 34 56" });
  });

  it("South Africa: two-digit country code, trunk 0 dropped", () => {
    expect(good("082 123 4567", "ZA")).toEqual({ e164: "+27821234567", country: "ZA", display: "+27 82 123 4567" });
    expect(good("+27 82 123 4567")).toMatchObject({ e164: "+27821234567", country: "ZA" });
  });

  it("India: the contact number from the PRD", () => {
    expect(good("+91 98157 25968")).toEqual({ e164: "+919815725968", country: "IN", display: "+91 98157 25968" });
    expect(good("09815725968", "IN").e164).toBe("+919815725968");
  });

  it("recognises the country from the number, whatever the form's country says", () => {
    expect(good("+234 803 123 4567", "CM").country).toBe("NG");
  });

  it("gives every country a rule whose display groups add up to its national length", () => {
    for (const [country, rule] of Object.entries(PHONE_RULES)) {
      expect(rule.groups.reduce((a, b) => a + b, 0), country).toBe(rule.nationalLength);
    }
  });
});

describe("normalisePhone: other countries get the generic E.164 check", () => {
  it("accepts a plausible international number and reports no country", () => {
    expect(good("+1 415 555 2671")).toEqual({ e164: "+14155552671", country: null, display: "+14155552671" });
    expect(good("0044 20 7946 0958").e164).toBe("+442079460958");
  });

  it("refuses an international number that is too short or too long", () => {
    expect(bad("+123456")).toBe("INVALID_LENGTH");
    expect(bad("+1234567890123456")).toBe("INVALID_LENGTH");
    expect(bad("+0123456789")).toBe("INVALID_LENGTH");
  });
});

describe("normalisePhone: refusals", () => {
  it("empty input", () => {
    for (const input of ["", "   ", "+", "()"]) expect(bad(input, "CM"), JSON.stringify(input)).toBe("EMPTY");
  });

  it("letters, symbols and a plus anywhere but the start", () => {
    for (const input of ["abc", "651 232 30x", "651#232301", "12+34", "+237 651 232 301 ext 4"]) {
      expect(bad(input, "CM"), input).toBe("INVALID_CHARACTERS");
    }
  });

  it("a national number with no usable country", () => {
    expect(bad("651232301")).toBe("NEEDS_COUNTRY");
    expect(bad("651232301", "XX")).toBe("NEEDS_COUNTRY");
    expect(bad("651232301", "constructor")).toBe("NEEDS_COUNTRY");
  });

  it("the wrong number of digits for a known country", () => {
    expect(bad("+237 65123")).toBe("INVALID_LENGTH");
    expect(bad("+237 6512323011")).toBe("INVALID_LENGTH");
    expect(bad("0651232301", "CM")).toBe("INVALID_LENGTH"); // Cameroon has no trunk 0
    expect(bad("+234 803 123 456")).toBe("INVALID_LENGTH");
    expect(bad("237651232301", "NG")).toBe("INVALID_LENGTH");
    expect(bad("0000000000", "NG")).toBe("INVALID_LENGTH");
  });
});

describe("isE164", () => {
  it("accepts a plus, a non-zero digit and 7 to 15 digits", () => {
    expect(isE164("+237651232301")).toBe(true);
    expect(isE164("+1234567")).toBe(true);
    expect(isE164("+123456789012345")).toBe(true);
  });

  it("refuses everything else", () => {
    for (const value of ["237651232301", "+0237651232301", "+123456", "+1234567890123456", "+237 651 232 301", "", null, undefined, 237651232301]) {
      expect(isE164(value), String(value)).toBe(false);
    }
  });
});
