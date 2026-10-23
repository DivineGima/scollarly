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

// The first ESLint run loads the Next.js plugins and can take over a minute on a cold machine.
describe("import boundaries (architecture 5, CLAUDE.md guardrails)", { timeout: 300_000 }, () => {
  it("rejects Drizzle and the Neon driver outside the repository layer", async () => {
    for (const dir of ["src/modules/x/service.ts", "src/app/api/v1/x/route.ts", "src/server/auth/x.ts", "src/lib/x.ts"]) {
      expect(await violations(dir, 'import { eq } from "drizzle-orm";\nexport const a = eq;\n')).not.toEqual([]);
      expect(await violations(dir, 'import { neon } from "@neondatabase/serverless";\nexport const a = neon;\n')).not.toEqual([]);
    }
  });

  it("allows Drizzle inside repositories and the db internals", async () => {
    for (const dir of ["src/server/repositories/x.ts", "src/server/db/x.ts"]) {
      expect(await violations(dir, 'import { eq } from "drizzle-orm";\nexport const a = eq;\n')).toEqual([]);
    }
  });

  it("rejects Better Auth outside src/server/auth, and allows it inside", async () => {
    const code = 'import { betterAuth } from "better-auth";\nexport const a = betterAuth;\n';
    for (const dir of ["src/modules/x/service.ts", "src/app/x/page.tsx", "src/server/repositories/x.ts", "src/server/email/x.ts"]) {
      expect(await violations(dir, code)).not.toEqual([]);
    }
    expect(await violations("src/server/auth/x.ts", code)).toEqual([]);
    expect(await violations("src/modules/x/service.ts", 'import { createAuthClient } from "better-auth/client";\nexport const a = createAuthClient;\n')).not.toEqual([]);
  });

  it("rejects Resend outside src/server/email, and allows it inside", async () => {
    const code = 'import { Resend } from "resend";\nexport const a = Resend;\n';
    expect(await violations("src/modules/x/service.ts", code)).not.toEqual([]);
    expect(await violations("src/server/auth/x.ts", code)).not.toEqual([]);
    expect(await violations("src/server/email/x.ts", code)).toEqual([]);
  });

  it("keeps admin libraries out of public components and public routes", async () => {
    const code = 'import { LineChart } from "recharts";\nexport const a = LineChart;\n';
    expect(await violations("src/components/public/x.tsx", code)).not.toEqual([]);
    expect(await violations("src/app/[locale]/(public)/page.tsx", code)).not.toEqual([]);
    expect(await violations("src/components/public/x.tsx", 'import { A } from "@/components/admin/a";\nexport const a = A;\n')).not.toEqual([]);
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

  it("only src/server/auth imports better-auth", () => {
    expect(importsOf(/from\s+["']better-auth/).filter((f) => !f.startsWith("src/server/auth/"))).toEqual([]);
  });

  it("only src/server/email references Resend", () => {
    expect(importsOf(/from\s+["']resend["']/).filter((f) => !f.startsWith("src/server/email/"))).toEqual([]);
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
