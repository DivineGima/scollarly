import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for the Stage 4 CPU repair (tracker Session 21). A fresh Worker instance runs the top level of every module its
 * entry imports before its first request, and Cloudflare reported that start-up as 37 to 40 ms of Worker Startup Time with a
 * third of lead requests landing on a fresh instance. These tests keep the lead and event paths free of what they do not need,
 * so a later change cannot quietly put it back.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Every .ts and .tsx file under a directory, as repo-relative paths. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The files a module imports at run time (a `import type` is erased by the compiler and costs nothing). */
function runtimeImports(file: string): string[] {
  const source = read(file);
  const found: string[] = [];
  for (const match of source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
    const spec = match[1] as string;
    let target: string | null = null;
    if (spec.startsWith("@/")) target = join("src", spec.slice(2));
    else if (spec.startsWith(".")) target = resolve(dirname(file), spec).replace(`${resolve(ROOT)}\\`, "").replace(`${resolve(ROOT)}/`, "");
    if (!target) continue;
    const candidate = [`${target}.ts`, `${target}.tsx`, join(target, "index.ts")].find((c) => existsSync(join(ROOT, c)));
    if (candidate) found.push(candidate.replace(/\\/g, "/"));
  }
  return found;
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...runtimeImports(file));
  }
  return seen;
}

describe("the Worker entry", () => {
  const entry = read("worker/index.ts");

  it("does not import the Next.js layer at the top: it is loaded when a request first needs it", () => {
    expect(entry).not.toMatch(/^import\s[^;]*["']\.\.\/\.open-next\/worker\.js["']/m);
    expect(entry).toMatch(/await import\(["']\.\.\/\.open-next\/worker\.js["']\)/);
  });

  it("exports only a handler and Durable Object classes (workerd refuses anything else, which a local run found)", () => {
    const exported = [...entry.matchAll(/^export (?:default|{ ([A-Za-z, ]+) }|const|let|function|class)/gm)].map((m) => m[0]);
    expect(exported.filter((e) => /const|let|function|class/.test(e))).toEqual([]);
  });

  it("takes the queue Durable Object from its own small file, not through the Next.js worker", () => {
    expect(entry).toMatch(/export \{ DOQueueHandler \} from ["']\.\.\/\.open-next\/\.build\/durable-objects\/queue\.js["']/);
  });

  it("tells the lead endpoint's caller which request of its instance this is (the measurement needs it), and nothing else about the instance", () => {
    expect(entry).toMatch(/const INSTANCE_REQUEST_HEADER = "X-Instance-Request"/);
    expect(entry).toMatch(/pathname !== "\/api\/v1\/leads"/);
  });
});

describe("the database handle", () => {
  it("is built without the schema object, so the first query of an instance does not build the relational config of every table", () => {
    const client = read("src/server/db/client.ts");
    expect(client).not.toMatch(/\{\s*schema\s*\}/);
    expect(client).not.toMatch(/^import\s+\{[^}]*\bschema\b[^}]*\}\s+from\s+["']\.\/schema["']/m);
    expect(client).toMatch(/import type \{ Schema \} from ["']\.\/schema["']/);
  });

  it("no code uses the relational query API, which is the one thing that needs the schema object", () => {
    const offenders = sourceFiles("src").filter((path) => /\bdb\.query\b|\.query\.[a-zA-Z]+\.find(First|Many)/.test(read(path)));
    expect(offenders).toEqual([]);
  });
});

describe("the lead and event paths load only what they need", () => {
  for (const entry of ["src/server/edge/leads.ts", "src/server/edge/events.ts"]) {
    it(`${entry} does not reach the schema file or the sign-in, admin or student code`, () => {
      const files = [...reachable(entry)];
      expect(files.filter((f) => f === "src/server/db/schema.ts")).toEqual([]);
      // `server/auth/cookie.ts` is the one allowed file: forty lines, no import, no SDK. The lead endpoint reads the session cookie with it
      // so a lead made by a signed-in student is linked to the account (S8.2); the sign-in code itself stays out.
      expect(files.filter((f) => /server\/auth\/(?!cookie\.ts$)|modules\/(auth|team|audit|profile|seed|student|content-admin|analytics)\/|edge\/(authed|sign-in|landing|mutations)/.test(f))).toEqual([]);
    });
  }

  it("the lead intake call and the settings read are in files of their own, and the old paths still re-export them", () => {
    expect(read("src/server/repositories/leads.ts")).toMatch(/export \{ insertLead[^}]*\} from ["']\.\/lead-intake["']/);
    expect(read("src/server/repositories/settings.ts")).toMatch(/export \{ readSettings \} from ["']\.\/settings-read["']/);
    expect(read("src/server/edge/leads.ts")).toContain('"@/server/repositories/lead-intake"');
    expect(read("src/server/edge/settings-cache.ts")).toContain('"@/server/repositories/settings-read"');
  });

  it("zod is imported as a namespace everywhere, which lets the bundler drop its unused language packs and converters", () => {
    const offenders = sourceFiles("src").filter((path) => /^import \{ z \} from "zod";/m.test(read(path)));
    expect(offenders).toEqual([]);
  });
});
