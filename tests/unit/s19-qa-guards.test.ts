import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S19.1 and S19.2 guards (essentials 5, Stage 19): rules of version 5 that nothing else holds, written as checks of the source so a later change
 * cannot break them quietly. They read files and run no code.
 */

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
const read = (path: string) => readFileSync(path, "utf8");

describe("S19.1: no personal data in logs (CLAUDE.md guardrail, architecture 15)", () => {
  // Every place the app writes a log line. A new one must be added here on purpose, and be reviewed for what it prints.
  const LOGGERS = ["src/server/edge/cron.ts", "src/server/edge/usage-job.ts", "src/server/log.ts", "src/server/security/rate-limit.ts"];
  const calls = sourceFiles("src").flatMap((file) =>
    read(file)
      .split(/\r?\n/)
      .map((line, i) => ({ file: file.replaceAll("\\", "/"), line: i + 1, text: line }))
      .filter((l) => /\bconsole\.(log|warn|error|info|debug)\(/.test(l.text)),
  );

  it("is written only by the known logging files", () => {
    expect([...new Set(calls.map((c) => c.file))].sort()).toEqual([...LOGGERS].sort());
  });

  it("never prints an error message, a name, an address or a number: a line carries fixed words, a count or an error class name", () => {
    for (const c of calls) {
      expect(c.text, `${c.file}:${c.line}`).not.toMatch(/\.message\b|\bemail\b|whatsapp|\bphone\b|\bname:|\bip\b|userId|studentId|leadId|\.key\b/i);
    }
  });
});

describe("S19.1: who can reach a student's document (architecture 24.5)", () => {
  const source = read("src/modules/documents/endpoints.ts");
  const access = (operation: string) => {
    const at = source.indexOf(`"${operation}": {`);
    expect(at, `${operation} is not declared`).toBeGreaterThan(-1);
    return /access: (\{[^}]*\})/.exec(source.slice(at, at + 200))?.[1] ?? "";
  };

  it("lets only a signed-in student upload, and nobody upload for a student except the Admin's letters", () => {
    expect(access("me/documents.sign")).toContain("signed-in");
    expect(access("me/documents.confirm")).toContain("signed-in");
    expect(access("admin/documents.sign")).toContain('role: "admin"');
    expect(access("admin/documents.confirm")).toContain('role: "admin"');
  });

  it("lets a manager review a document, and only the Admin approve a proof of payment", () => {
    expect(access("admin/documents.review")).toContain('role: "manager"');
    expect(access("admin/payments.proofApprove")).toContain('role: "admin"');
  });

  it("opens a file only through the two link calls, one for the student's own and one for staff, both by area prefix", () => {
    for (const name of ["me/documents", "me/document-link", "admin/student-documents", "admin/document-link"]) expect(source, name).toContain(`"${name}": async`);
    expect(source).not.toMatch(/"(public|api)\/[a-z-]*document/);
  });
});

describe("S19.2: the CPU measurement covers version 5", () => {
  const measure = read("scripts/measure-cpu.mjs");

  it("has a row, a gate of 8 ms and a place in the default list for every new call", () => {
    for (const key of ["admin-inbox", "admin-notifications-count", "me-documents", "me-application-form", "me-documents-sign"]) {
      expect(measure, `${key} has no scenario`).toMatch(new RegExp(`"${key}",\\s`));
      expect(measure, `${key} has no limit`).toMatch(new RegExp(`"${key}": 8`));
      expect(measure, `${key} is not in the default list`).toMatch(new RegExp(`const only = new Set\\([^\\n]*${key}`));
    }
  });

  it("gives the throwaway admin a passed second factor, because a stored admin without one is a student since version 5", () => {
    const seed = read("scripts/ci/seed-probe-sessions.mjs");
    expect(seed).toContain("insert into public.step_up");
    expect(seed).toMatch(/role === "admin"/);
  });
});
