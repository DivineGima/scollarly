import { describe, expect, it } from "vitest";
import { formBody } from "@/modules/application-form/schema";
import { decidePassport, isValidBirthDate, normaliseFormPhone, prefillOf, type ProfileFormRow } from "@/modules/application-form/service";
import { deleteAfterErasure, PURGE_LIMIT, runPurge } from "@/server/media/purge";

const PROFILE: ProfileFormRow = {
  applicantName: "Ada Eze",
  contactWhatsapp: "+2348031234567",
  courseFields: ["law"],
  intakeYear: 2027,
  applicantCountry: "NG",
  dateOfBirth: null,
  gender: null,
  nationality: null,
  residenceState: null,
  city: null,
  address: null,
  guardianName: null,
  guardianPhone: null,
  motherName: null,
  motherPhone: null,
  passportNumber: null,
  formCompletedAt: null,
};

const GOOD = {
  dateOfBirth: "2005-03-14",
  gender: "female",
  nationality: "NG",
  residenceState: "Lagos",
  city: "Ikeja",
  address: "12 Allen Avenue",
  guardianName: "Chidi Eze",
  guardianPhone: "+2348031111111",
  motherName: "Ngozi Eze",
  motherPhone: "+2348032222222",
};

describe("S17.2 prefill (FR-43)", () => {
  it("fills in what the student already told us and leaves the rest blank", () => {
    const form = prefillOf(PROFILE, "ada@example.test");
    expect(form.fixed).toEqual({ name: "Ada Eze", whatsapp: "+2348031234567", email: "ada@example.test", courseFields: ["law"], academicYear: 2027 });
    expect(form.values.nationality).toBe("NG"); // the country they signed up from stands in
    expect(form.values.city).toBe("");
    expect(form.completed).toBe(false);
  });

  it("never overwrites what the student has typed", () => {
    const form = prefillOf({ ...PROFILE, nationality: "CM", city: "Douala", formCompletedAt: "2026-11-07T00:00:00.000Z" }, null);
    expect(form.values.nationality).toBe("CM");
    expect(form.values.city).toBe("Douala");
    expect(form.fixed.email).toBeNull();
    expect(form.completed).toBe(true);
  });
});

describe("S17.2 validation", () => {
  it("accepts a complete form, normalises the phones and the passport", () => {
    const parsed = formBody.safeParse({ ...GOOD, guardianPhone: "+234 803 111 1111", passportNumber: " a 1234567 " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.guardianPhone).toBe("+2348031111111");
      expect(parsed.data.passportNumber).toBe("A1234567");
    }
  });

  it("refuses a missing field, an unknown field, a bad gender and a bad country", () => {
    expect(formBody.safeParse({ ...GOOD, city: "" }).success).toBe(false);
    expect(formBody.safeParse({ ...GOOD, extra: 1 }).success).toBe(false);
    expect(formBody.safeParse({ ...GOOD, gender: "x" }).success).toBe(false);
    expect(formBody.safeParse({ ...GOOD, nationality: "XX" }).success).toBe(false);
    const { address: _address, ...without } = GOOD;
    expect(formBody.safeParse(without).success).toBe(false);
  });

  it("refuses text that is too long and a phone that cannot be right", () => {
    expect(formBody.safeParse({ ...GOOD, address: "x".repeat(301) }).success).toBe(false);
    expect(formBody.safeParse({ ...GOOD, motherPhone: "12" }).success).toBe(false);
    expect(formBody.safeParse({ ...GOOD, motherPhone: "call me" }).success).toBe(false);
  });

  it("accepts a blank passport and refuses a malformed one", () => {
    expect(formBody.safeParse({ ...GOOD, passportNumber: "" }).success).toBe(true);
    expect(formBody.safeParse({ ...GOOD, passportNumber: "AB1" }).success).toBe(false);
    expect(formBody.safeParse({ ...GOOD, passportNumber: "AB-123456" }).success).toBe(false);
  });
});

describe("S17.2 dates and phones", () => {
  const now = new Date("2026-11-07T10:00:00Z");

  it("takes a real date between 1940 and today, and nothing else", () => {
    expect(isValidBirthDate("2005-03-14", now)).toBe(true);
    expect(isValidBirthDate("1940-01-01", now)).toBe(true);
    expect(isValidBirthDate("2026-11-07", now)).toBe(true);
    expect(isValidBirthDate("2026-11-08", now)).toBe(false); // tomorrow
    expect(isValidBirthDate("1939-12-31", now)).toBe(false);
    expect(isValidBirthDate("2005-02-30", now)).toBe(false); // no such day
    expect(isValidBirthDate("14/03/2005", now)).toBe(false);
    expect(isValidBirthDate("", now)).toBe(false);
  });

  it("reads a number without a plus as Cameroonian, and one with a plus as it is", () => {
    expect(normaliseFormPhone("612 345 678")).toBe("+237612345678");
    expect(normaliseFormPhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normaliseFormPhone("12")).toBeNull();
  });
});

describe("S17.2 the passport switch", () => {
  it("is required when the university asks, and ignored (never stored) when it does not", () => {
    expect(decidePassport(true, undefined)).toEqual({ ok: false });
    expect(decidePassport(true, "   ")).toEqual({ ok: false });
    expect(decidePassport(true, "A1234567")).toEqual({ ok: true, store: "A1234567" });
    expect(decidePassport(false, "A1234567")).toEqual({ ok: true, store: null });
    expect(decidePassport(false, undefined)).toEqual({ ok: true, store: null });
  });
});

describe("S17.3 the purge run (architecture 24.7)", () => {
  const candidates = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, key: `s/${i}` }));

  it("asks for at most 40 objects, even if told to take more", async () => {
    let asked = 0;
    await runPurge(
      {
        candidates: async (limit) => {
          asked = limit;
          return [];
        },
        deleteObject: async () => undefined,
        markPurged: async () => 0,
      },
      500,
    );
    expect(PURGE_LIMIT).toBe(40);
    expect(asked).toBe(40);
  });

  it("deletes each object, then marks them all in one call", async () => {
    const deleted: string[] = [];
    const marks: string[][] = [];
    const result = await runPurge({
      candidates: async () => candidates(3),
      deleteObject: async (key) => void deleted.push(key),
      markPurged: async (ids) => {
        marks.push(ids);
        return ids.length;
      },
    });
    expect(deleted).toEqual(["s/0", "s/1", "s/2"]);
    expect(marks).toEqual([["id-0", "id-1", "id-2"]]);
    expect(result).toEqual({ found: 3, deleted: 3, marked: 3, failed: 0 });
  });

  it("leaves the row of a failed delete for tomorrow, and still marks the ones that were deleted", async () => {
    const marks: string[][] = [];
    const result = await runPurge({
      candidates: async () => candidates(3),
      deleteObject: async (key) => {
        if (key === "s/1") throw new Error("storage down");
      },
      markPurged: async (ids) => {
        marks.push(ids);
        return ids.length;
      },
    });
    expect(marks).toEqual([["id-0", "id-2"]]);
    expect(result).toMatchObject({ found: 3, deleted: 2, failed: 1 });
  });

  it("does nothing, and marks nothing, when nothing qualifies (a second run is harmless)", async () => {
    const result = await runPurge({ candidates: async () => [], deleteObject: async () => Promise.reject(new Error("never")), markPurged: async (ids) => ids.length });
    expect(result).toEqual({ found: 0, deleted: 0, marked: 0, failed: 0 });
  });

  it("throws when the rows cannot be marked, so the run is recorded as failed", async () => {
    await expect(runPurge({ candidates: async () => candidates(1), deleteObject: async () => undefined, markPurged: async () => Promise.reject(new Error("db down")) })).rejects.toThrow("db down");
  });
});

describe("S17.3 deleting after an erasure", () => {
  it("tries each object twice and reports how many could not be deleted", async () => {
    const calls: string[] = [];
    const failed = await deleteAfterErasure(
      async (key) => {
        calls.push(key);
        if (key === "bad") throw new Error("down");
      },
      ["a", "bad", "b"],
    );
    expect(failed).toBe(1);
    expect(calls).toEqual(["a", "bad", "bad", "b"]);
  });

  it("succeeds with nothing to delete", async () => {
    expect(await deleteAfterErasure(async () => undefined, [])).toBe(0);
  });
});
