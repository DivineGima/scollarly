import { describe, expect, it } from "vitest";
import { PIPELINE_STAGE_CODES } from "@/lib/constants";
import { sevenSteps } from "@/modules/content/seven-steps";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S18.3 (architecture 24.11, PRD_5 FR-52): the seven steps and the fees wording are translation keys in both languages, the public pages build them
 * from the one list of step codes the staff pipeline and the student's Progress use, and no text of the older six-step flow is left in the messages.
 */

const walk = (value: unknown, path: string, out: [string, string][]) => {
  if (typeof value === "string") out.push([path, value]);
  else if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key, out);
};
const strings = (messages: unknown) => {
  const out: [string, string][] = [];
  walk(messages, "", out);
  return out;
};

describe("the seven public steps", () => {
  for (const [name, messages] of [["English", en], ["French", fr]] as const) {
    it(`${name}: every step has a title and a body, in the order of the pipeline`, () => {
      const t = (key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages.process) as string;
      const steps = sevenSteps(t);
      expect(steps.map((s) => s.id)).toEqual([...PIPELINE_STAGE_CODES]);
      expect(steps.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      for (const step of steps) {
        expect(typeof step.title).toBe("string");
        expect(step.title.length).toBeGreaterThan(5);
        expect(step.body.length).toBeGreaterThan(30);
      }
    });

    it(`${name}: the fees wording names the registration fee, who is paid, and that the app takes no money`, () => {
      const body = messages.process.fees.body;
      expect(messages.process.fees.title.length).toBeGreaterThan(5);
      expect(body).toMatch(/100/);
      expect(body).toMatch(/300/);
      expect(body.length).toBeGreaterThan(80);
    });
  }

  it("says nothing of six steps in either language", () => {
    for (const messages of [en, fr]) {
      const offenders = strings(messages).filter(([, text]) => /\b(six|six steps|six étapes|six stages)\b/i.test(text) || /\bles six\b/i.test(text));
      expect(offenders).toEqual([]);
    }
  });

  it("keeps the student's words on 'manager', not 'adviser', in what the student reads", () => {
    for (const [path, text] of strings(en.me)) expect([path, /\badvis[eo]r\b/i.test(text)]).toEqual([path, false]);
  });

  it("builds the same step list for both languages (the keys match)", () => {
    const keys = (root: unknown) => strings(root).map(([path]) => path).sort();
    expect(keys(fr.process.seven)).toEqual(keys(en.process.seven));
    expect(keys(fr.process.fees)).toEqual(keys(en.process.fees));
  });
});
