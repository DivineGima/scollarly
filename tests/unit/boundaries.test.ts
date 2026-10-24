import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, "eslint.config.mjs") });

async function violations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, filePath) });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const importLine = (what: string, from: string) => `import ${what} from "${from}";\nexport const a = 1;\n`;

// The first ESLint run loads the Next.js plugins and can take over a minute on a cold machine.
describe("import boundaries (architecture 5, CLAUDE.md guardrails)", { timeout: 300_000 }, () => {
  it("rejects Drizzle and the Neon driver outside the repository layer", async () => {
    for (const dir of ["src/modules/x/service.ts", "src/app/api/v1/x/route.ts", "src/server/auth/x.ts", "src/lib/x.ts"]) {
      expect(await violations(dir, importLine("{ eq }", "drizzle-orm"))).not.toEqual([]);
      expect(await violations(dir, importLine("{ neon }", "@neondatabase/serverless"))).not.toEqual([]);
    }
  });

  it("allows Drizzle inside repositories and the db internals", async () => {
    for (const dir of ["src/server/repositories/x.ts", "src/server/db/x.ts"]) {
      expect(await violations(dir, importLine("{ eq }", "drizzle-orm"))).toEqual([]);
    }
  });

  it("rejects the Neon Auth SDK, otpauth and Better Auth outside src/server/auth, and allows them inside", async () => {
    const imports = [
      importLine("{ handleAuthProxyRequest }", "@neondatabase/auth/server"),
      importLine("* as OTPAuth", "otpauth"),
      importLine("{ betterAuth }", "better-auth"),
      importLine("{ createAuthClient }", "better-auth/client"),
    ];
    for (const code of imports) {
      for (const dir of ["src/modules/x/service.ts", "src/app/x/page.tsx", "src/server/repositories/x.ts", "src/server/media/x.ts"]) {
        expect(await violations(dir, code), `${dir}: ${code}`).not.toEqual([]);
      }
      expect(await violations("src/server/auth/x.ts", code)).toEqual([]);
    }
  });

  it("rejects the object storage client outside src/server/media, and allows it inside", async () => {
    const code = importLine("{ AwsClient }", "aws4fetch");
    for (const dir of ["src/modules/x/service.ts", "src/server/auth/x.ts", "src/server/repositories/x.ts", "src/server/edge/x.ts"]) {
      expect(await violations(dir, code), dir).not.toEqual([]);
    }
    expect(await violations("src/server/media/x.ts", code)).toEqual([]);
  });

  it("rejects Resend everywhere: it was removed (ADR-036)", async () => {
    const code = importLine("{ Resend }", "resend");
    for (const dir of ["src/modules/x/service.ts", "src/server/auth/x.ts", "src/server/email/x.ts", "src/server/media/x.ts"]) {
      expect(await violations(dir, code), dir).not.toEqual([]);
    }
  });

  it("keeps admin libraries out of public components and public routes", async () => {
    const code = importLine("{ LineChart }", "recharts");
    expect(await violations("src/components/public/x.tsx", code)).not.toEqual([]);
    expect(await violations("src/app/[locale]/(public)/page.tsx", code)).not.toEqual([]);
    expect(await violations("src/components/public/x.tsx", importLine("{ A }", "@/components/admin/a"))).not.toEqual([]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("source scan: belt and braces over the lint rules", () => {
  const files = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
  const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
  const importsOf = (pkg: RegExp) => files.filter((f) => pkg.test(readFileSync(f, "utf8"))).map(rel);

  it("only src/server/repositories and src/server/db import Drizzle or the Neon driver", () => {
    const offenders = importsOf(/from\s+["'](drizzle-orm|@neondatabase\/serverless)/).filter((f) => !/^src\/server\/(repositories|db)\//.test(f));
    expect(offenders).toEqual([]);
  });

  it("only src/server/auth imports the Neon Auth SDK, otpauth or Better Auth", () => {
    expect(importsOf(/from\s+["'](@neondatabase\/auth|otpauth|better-auth|@better-auth)/).filter((f) => !f.startsWith("src/server/auth/"))).toEqual([]);
  });

  it("only src/server/media imports the object storage client", () => {
    expect(importsOf(/from\s+["'](aws4fetch|@aws-sdk)/).filter((f) => !f.startsWith("src/server/media/"))).toEqual([]);
  });

  it("does not import Resend anywhere, and has no email folder (ADR-036)", () => {
    expect(importsOf(/from\s+["']resend["']/)).toEqual([]);
    expect(existsSync(join(ROOT, "src/server/email"))).toBe(false);
  });

  it("gives every table in the schema row level security, forced, and a policy in a migration (ADR-038)", () => {
    const schema = readFileSync(join(ROOT, "src/server/db/schema.ts"), "utf8");
    const dir = join(ROOT, "src/server/db/migrations");
    const migrations = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    const tables = [...schema.matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1] ?? "");
    expect(tables.length).toBeGreaterThanOrEqual(7);
    for (const table of tables) {
      expect(migrations, `${table}: ENABLE`).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
      expect(migrations, `${table}: FORCE`).toMatch(new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
      expect(migrations, `${table}: policy`).toMatch(new RegExp(`CREATE POLICY \\w+ ON public\\.${table} `));
    }
  });

  it("has no Next.js middleware, so access control can never live there (ADR-005)", () => {
    for (const name of ["src/middleware.ts", "middleware.ts", "src/proxy.ts", "proxy.ts"]) {
      expect(existsSync(join(ROOT, name)), name).toBe(false);
    }
  });

  it("does not hardcode a WhatsApp number or wa.me link (FR-4)", () => {
    expect(importsOf(/wa\.me\/\+?\d|api\.whatsapp\.com\/send\?phone=\d|\+237\s?651/)).toEqual([]);
  });

  it("has no client component on a page (architecture 15, constraint 5)", () => {
    const offenders = files.filter((f) => /\/page\.tsx$/.test(f.split(sep).join("/")) && /^\s*["']use client["']/m.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("does not use the Next.js image optimiser or third-party scripts (ADR-024)", () => {
    expect(importsOf(/from\s+["']next\/image["']|<Script\b|next\/script/)).toEqual([]);
  });
});
