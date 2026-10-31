import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { UniversityList } from "@/components/student/university-list";
import { COURSE_FIELDS } from "@/lib/courses";
import { isKeptShell, isNeverCached, KEPT_SHELL_CACHE, keptShellResponse, SHELL_HEADER, shellKey } from "@/lib/sw-rules";
import { toCourseCatalogue } from "@/modules/content/course-catalogue";
import type { CatalogueSnapshot, UniversityView } from "@/modules/content/types";
import { firstNameOf } from "@/modules/student/endpoints";
import { gradeRank, orderUniversities, type CatalogueEntry } from "@/modules/student/ordering";
import { mintActor, type Actor } from "@/server/auth/actor";
import { type AuthedDeps, handleAuthed } from "@/server/edge/authed";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * S13.4 (architecture 21.7, 21.11; F16): the student app's ordering rule, the public catalogue it is made from, what the service worker may
 * keep, and the words. The data calls are tested against a real database in tests/integration/s13-4-student-app.test.ts; the screens
 * in tests/e2e/s13-4-student-app.spec.ts.
 */

const uni = (name: string, naacGrade: string | null, fields: string[], city: string | null = null): CatalogueEntry => ({ slug: name.toLowerCase().replace(/\W+/g, "-"), name, city, naacGrade, fields });
const names = (list: readonly { name: string }[]) => list.map((u) => u.name);

describe("ordering the universities (owner decision D8, ADR-044)", () => {
  const catalogue = [
    uni("Delta University", null, ["law"]),
    uni("Alpha University", "A", ["computer_science_it", "law"]),
    uni("Beta University", "A++", ["mechanical_engineering"]),
    uni("Gamma University", "B+", ["computer_science_it"]),
    uni("Epsilon University", "A++", ["computer_science_it"]),
  ];

  it("puts the universities offering the chosen course first, then the best NAAC grade", () => {
    expect(names(orderUniversities(catalogue, ["computer_science_it"]))).toEqual(["Epsilon University", "Alpha University", "Gamma University", "Beta University", "Delta University"]);
  });

  it("lists the rest by grade too, with a grade that is not stated last", () => {
    // None offers civil engineering, so nothing matches: the order is the grade, then the name.
    expect(names(orderUniversities(catalogue, ["civil_engineering"]))).toEqual(["Beta University", "Epsilon University", "Alpha University", "Gamma University", "Delta University"]);
  });

  it("breaks a tie by name, A to Z", () => {
    const tied = [uni("Zed", "A+", ["law"]), uni("Abe", "A+", ["law"]), uni("Mid", "A+", ["law"])];
    expect(names(orderUniversities(tied, ["law"]))).toEqual(["Abe", "Mid", "Zed"]);
    expect(names(orderUniversities(tied, []))).toEqual(["Abe", "Mid", "Zed"]);
  });

  it("treats several chosen courses as 'any of them', and says which ones a university offers, in the order the person chose them", () => {
    const ordered = orderUniversities(catalogue, ["law", "computer_science_it"]);
    expect(ordered.find((u) => u.name === "Alpha University")?.matches).toEqual(["law", "computer_science_it"]);
    expect(ordered.find((u) => u.name === "Beta University")?.matches).toEqual([]);
    // Everything that offers either course comes before Beta, which offers neither.
    expect(names(ordered).indexOf("Beta University")).toBe(4);
  });

  it("puts a stated grade that is not on the list after the listed grades and before 'not stated'", () => {
    const list = [uni("A", null, []), uni("B", "C", []), uni("C", "B", []), uni("D", "weird", [])];
    expect(names(orderUniversities(list, []))).toEqual(["C", "B", "D", "A"]);
    expect(gradeRank(" a++ ")).toBe(0);
    expect(gradeRank("")).toBe(gradeRank(null));
    expect(gradeRank("a+")).toBeLessThan(gradeRank("A"));
  });

  it("orders the whole list by grade when nothing is chosen (someone who has not finished onboarding)", () => {
    expect(names(orderUniversities(catalogue, []))).toEqual(["Beta University", "Epsilon University", "Alpha University", "Gamma University", "Delta University"]);
  });

  it("ignores a chosen value that is not a course, and never changes the list it was given", () => {
    const before = JSON.stringify(catalogue);
    expect(orderUniversities(catalogue, ["astrology"]).every((u) => u.matches.length === 0)).toBe(true);
    orderUniversities(catalogue, ["law"]);
    expect(JSON.stringify(catalogue)).toBe(before);
  });

  it("copes with an empty catalogue", () => {
    expect(orderUniversities([], ["law"])).toEqual([]);
  });
});

describe("the public catalogue", () => {
  const view = (over: Partial<UniversityView>): UniversityView =>
    ({ id: "id", slug: "alpha", name: "Alpha", city: "Pune", state: null, type: null, naacGrade: "A", websiteUrl: null, logo: null, overview: "", programmes: [], fees: [], experiences: [], resources: [], ...over }) as UniversityView;
  const programme = (field: string | null) => ({ id: `p-${field}`, name: "P", level: "undergraduate", field, durationMonths: 36 });

  it("holds only what the order needs, and the distinct valid course fields of the published programmes", () => {
    const snapshot: CatalogueSnapshot = { universities: [view({ programmes: [programme("law"), programme("law"), programme("computer_science_it"), programme(null), programme("astrology")] })] };
    const [entry] = toCourseCatalogue(snapshot);
    expect(entry).toEqual({ slug: "alpha", name: "Alpha", city: "Pune", naacGrade: "A", fields: ["law", "computer_science_it"] });
    expect(Object.keys(entry as object).sort()).toEqual(["city", "fields", "naacGrade", "name", "slug"]);
  });

  it("is empty when nothing is published", () => {
    expect(toCourseCatalogue({ universities: [] })).toEqual([]);
  });
});

describe("the university list", () => {
  const labels = { naac: "NAAC {grade}", naacMissing: "NAAC grade not stated", offers: "Offers your course: {courses}", open: "View {name}" };
  const names = Object.fromEntries(COURSE_FIELDS.map((f) => [f, f.toUpperCase()]));

  it("shows the grade, or says it is not stated, and the courses it offers that the person chose", () => {
    const items = orderUniversities([uni("Alpha", "A++", ["law"], "Pune"), uni("Beta", null, ["law"])], ["law"]);
    const html = renderToStaticMarkup(createElement(UniversityList, { items, courseNames: names, labels }));
    expect(html).toContain("NAAC A++");
    expect(html).toContain("NAAC grade not stated");
    expect(html).toContain("Offers your course: LAW");
    expect(html).toContain("Pune");
    expect(html).toContain('aria-label="View Alpha"');
    expect(html).toContain('href="/universities/alpha"');
  });

  it("shows no match line for a university that offers none of the chosen courses", () => {
    const items = orderUniversities([uni("Alpha", "A", ["law"])], ["civil_engineering"]);
    expect(renderToStaticMarkup(createElement(UniversityList, { items, courseNames: names, labels }))).not.toContain("Offers your course");
  });
});

describe("the first name", () => {
  it("is the first word only, never the whole name", () => {
    expect(firstNameOf("Ada Eze")).toBe("Ada");
    expect(firstNameOf("  Ngozi   Eze Okafor ")).toBe("Ngozi");
    expect(firstNameOf("Ada")).toBe("Ada");
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf("   ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf("x".repeat(100))?.length).toBe(40);
  });
});

describe("what the service worker may keep (21.11, ADR-047)", () => {
  it("keeps only the signed-in app's own shells: the student's pages and the staff's four tabs, Notifications and Profile", () => {
    for (const path of ["/me", "/me/", "/me/universities", "/me/progress", "/me/help", "/me/notifications", "/me/profile", "/me/data", "/me/link-application", "/me/onboarding", "/en/me", "/en/me/universities/", "/admin", "/admin/leads", "/admin/content", "/admin/insights", "/admin/notifications", "/admin/profile", "/en/admin/"]) {
      expect(isKeptShell(path), path).toBe(true);
    }
  });

  it("never keeps anything else signed-in: no API, no staff pages, no probes, no sign-in or account pages", () => {
    for (const path of ["/api/v1/me/home", "/api/v1/me/onboarding", "/admin/leads/abc", "/admin/team", "/admin/audit", "/admin/security", "/admin/settings", "/admin/health", "/admin/payments", "/admin/phase0", "/me/phase0", "/me/unknown", "/me/universities/x", "/account/confirm", "/sign-in", "/sign-out", "/two-factor", "/universities", "/"]) {
      expect(isKeptShell(path), path).toBe(false);
    }
  });

  it("still refuses to cache them the ordinary way (the rule is a network-first exception, not a cache-first one)", () => {
    expect(isNeverCached("/me/universities")).toBe(true);
    expect(isNeverCached("/api/v1/me/home")).toBe(true);
  });

  it("keeps one copy per tab, whatever the trailing slash or query", () => {
    expect(shellKey(new URL("https://scollarly.test/me/universities/?x=1"))).toBe("https://scollarly.test/me/universities");
    expect(shellKey(new URL("https://scollarly.test/me"))).toBe("https://scollarly.test/me");
    expect(shellKey(new URL("https://scollarly.test/"))).toBe("https://scollarly.test/");
    expect(KEPT_SHELL_CACHE).toBe("signed-in-shells");
  });
});

describe("the kept shell: network first, the copy only when the network fails", () => {
  const url = new URL("https://scollarly.test/me/universities");
  const request = () => new Request(url);
  const memory = () => {
    const store = new Map<string, Response>();
    return { store, cache: async () => ({ put: async (key: string, response: Response) => void store.set(key, response), match: async (key: string) => store.get(key)?.clone() }) as unknown as Pick<Cache, "put" | "match"> };
  };
  const shell = (status = 200, marked = true) => new Response("<html>shell</html>", { status, headers: marked ? { [SHELL_HEADER]: "1" } : {} });

  it("asks the network first and keeps a marked shell", async () => {
    const { store, cache } = memory();
    const response = await keptShellResponse(request(), url, { fetch: async () => shell(), cache });
    expect(await response.text()).toBe("<html>shell</html>");
    expect([...store.keys()]).toEqual(["https://scollarly.test/me/universities"]);
  });

  it("serves the kept copy when the network fails, and says nothing else was asked of the network", async () => {
    const { cache } = memory();
    await keptShellResponse(request(), url, { fetch: async () => shell(), cache });
    const offline = await keptShellResponse(request(), url, { fetch: async () => Promise.reject(new TypeError("offline")), cache });
    expect(await offline.text()).toBe("<html>shell</html>");
  });

  it("prefers the network when it answers, even if a copy is kept (the session check still runs online)", async () => {
    const { cache } = memory();
    await keptShellResponse(request(), url, { fetch: async () => shell(), cache });
    const fresh = await keptShellResponse(request(), url, { fetch: async () => new Response("signed out", { status: 404 }), cache });
    expect(fresh.status).toBe(404);
    expect(await fresh.text()).toBe("signed out");
  });

  it("keeps nothing that is not a marked 200: a 404 for a signed-out visitor, an unmarked page, an error", async () => {
    for (const response of [shell(404), shell(200, false), shell(500)]) {
      const { store, cache } = memory();
      await keptShellResponse(request(), url, { fetch: async () => response.clone(), cache });
      expect(store.size).toBe(0);
    }
  });

  it("rethrows the network error when nothing is kept, so the offline page applies", async () => {
    const { cache } = memory();
    await expect(keptShellResponse(request(), url, { fetch: async () => Promise.reject(new TypeError("offline")), cache })).rejects.toThrow("offline");
  });

  it("keeps one copy per tab", async () => {
    const { store, cache } = memory();
    await keptShellResponse(request(), new URL("https://scollarly.test/me/help/?x=1"), { fetch: async () => shell(), cache });
    await keptShellResponse(request(), new URL("https://scollarly.test/me/help"), { fetch: async () => shell(), cache });
    expect(store.size).toBe(1);
  });
});

describe("the Worker marks a signed-in shell, and nothing else", () => {
  const actor: Actor = mintActor({ userId: "u1", sessionId: "s1", storedRole: "student", role: "student", twoFactorVerifiedAt: null, accountConfirmed: true });
  const deps = (): AuthedDeps => ({
    checkSession: async () => actor,
    cache: { match: async () => new Response("<html>shell</html>", { headers: { "content-type": "text/html" } }), put: async () => undefined },
    next: async () => new Response("<html>next</html>", { headers: { "content-type": "text/html" } }),
    waitUntil: () => undefined,
    api: { "me/home": async () => ({ ok: true }) },
  });
  const run = (path: string) => handleAuthed(new Request(`https://scollarly.test${path}`), () => deps());

  it("marks the shell, privately, so the service worker may keep it", async () => {
    const response = (await run("/me/universities")) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get(SHELL_HEADER)).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not mark a data call or a refusal", async () => {
    const data = (await run("/api/v1/me/home")) as Response;
    expect(data.headers.get(SHELL_HEADER)).toBeNull();
    const none = (await handleAuthed(new Request("https://scollarly.test/me/universities"), () => ({ ...deps(), checkSession: async () => null }))) as Response;
    expect(none.status).toBe(404);
    expect(none.headers.get(SHELL_HEADER)).toBeNull();
  });
});

describe("the words", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`)) : [prefix.slice(0, -1)];

  it("has the same student strings in English and French", () => {
    expect(keys(fr.student).sort()).toEqual(keys(en.student).sort());
  });

  it("says plainly when a grade is not stated", () => {
    expect(en.student.universities.naacMissing).toBe("NAAC grade not stated");
  });

  it("has a name for every tab and More row the student app shows", () => {
    for (const key of ["home", "universities", "progress", "help"] as const) expect(en.shell.tabs[key], key).toBeTruthy();
    for (const key of ["profile", "data"] as const) expect(en.shell.sheet.items[key], key).toBeTruthy();
  });
});
