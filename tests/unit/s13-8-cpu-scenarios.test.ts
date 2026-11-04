import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S13.8 and tracker flag F26: architecture 21.13 asks for a measured CPU row on every new function, and a row can only be measured if the
 * measurement script drives it. This keeps the script honest: each version 2 call has a scenario, a gate, and a place in the default list,
 * and the pending accounts the confirm scenario needs are made by the seed script. The numbers themselves come from a deploy run.
 */

const script = readFileSync("scripts/measure-cpu.mjs", "utf8");
const seed = readFileSync("scripts/ci/seed-probe-sessions.mjs", "utf8");

const SCENARIOS: Record<string, string> = {
  "account-confirm": "/api/v1/account/confirm",
  "me-home": "/api/v1/me/home",
  "me-notifications": "/api/v1/me/notifications",
  "admin-home": "/api/v1/admin/home",
  "admin-notifications": "/api/v1/admin/notifications",
  "admin-tour": "/api/v1/admin/tour.seen",
  "legacy-redirect": "/admin/payments",
};

describe("the CPU measurement drives every version 2 call", () => {
  const defaultList = /const only = new Set\(\(args\.only \?\? "([^"]+)"\)/.exec(script)?.[1]?.split(",") ?? [];
  const limits = /const LIMITS = \{([^}]+)\}/.exec(script)?.[1] ?? "";

  for (const [key, path] of Object.entries(SCENARIOS)) {
    it(`${key}: has a gate of 8 ms, is in the default list and calls ${path}`, () => {
      expect(defaultList).toContain(key);
      expect(limits).toMatch(new RegExp(`"${key}": 8\\b`));
      expect(script).toContain(`"${key}"`);
      expect(script).toContain(path);
    });
  }

  it("makes pending accounts (no confirmed time) for the confirm scenario, and cleans them up with the other probe users", () => {
    expect(seed).toContain("PENDING_PROBES");
    expect(seed).toMatch(/values \(\$1, 'student', null\)/);
    expect(seed).toContain("s010-probe-pending-");
    // The cleanup finds every probe user by this one pattern, so a pending user is removed with the rest.
    expect(seed).toContain('const EMAIL_PATTERN = "s010-probe-%@scollarly.invalid"');
  });

  it("sends every new write from the site's own origin, with an idempotency key", () => {
    for (const path of ["/api/v1/account/confirm", "/api/v1/admin/tour.seen"]) {
      const around = script.slice(script.indexOf(path), script.indexOf(path) + 600);
      expect(around).toContain("origin: base");
      expect(around).toContain("idempotency-key");
    }
  });
});
