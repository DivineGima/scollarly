import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_PERMISSION, can, canDo, PERMISSION_ROLES, PERMISSIONS, type PermissionRole } from "@/server/auth/permissions";

const ROOT = process.cwd();

/** CLAUDE.md step 3: the current architecture is the highest `system_architecture_N.md` in /system_architecture/. */
function currentArchitecture(): string {
  const dir = join(ROOT, "system_architecture");
  const versions = readdirSync(dir)
    .map((name) => /^system_architecture_(\d+)\.md$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[0], n: Number(m[1]) }))
    .sort((a, b) => b.n - a.n);
  const latest = versions[0];
  if (!latest) throw new Error("No system_architecture_N.md found");
  return readFileSync(join(dir, latest.name), "utf8");
}

interface Row {
  label: string;
  allow: Record<PermissionRole, boolean>;
  needs2fa: boolean;
}

/** Reads the table under "### 9.5 Permission matrix". */
function parseMatrix(markdown: string): Row[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^###\s+9\.5\s+Permission matrix/.test(line));
  if (start < 0) throw new Error("Section 9.5 not found");
  const rows: Row[] = [];
  let seenHeader = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s/.test(line)) break;
    if (!line.startsWith("|")) {
      if (seenHeader && rows.length > 0) break;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5) continue;
    if (/^-+$/.test((cells[1] ?? "").replace(/:/g, ""))) continue;
    if ((cells[0] ?? "").toLowerCase() === "capability") {
      seenHeader = true;
      expect(cells.slice(1).map((c) => c.toLowerCase())).toEqual(["anonymous", "student", "admin", "owner"]);
      continue;
    }
    const yes = (cell: string | undefined) => /^yes\b/i.test(cell ?? "");
    rows.push({
      label: cells[0] ?? "",
      allow: { anonymous: yes(cells[1]), student: yes(cells[2]), admin: yes(cells[3]), owner: yes(cells[4]) },
      needs2fa: /2FA/.test(cells[4] ?? ""),
    });
  }
  return rows;
}

describe("src/server/auth/permissions.ts matches the architecture 9.5 table", () => {
  const rows = parseMatrix(currentArchitecture());

  it("finds the table", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it("has exactly the same capabilities, in the same order, word for word", () => {
    expect(PERMISSIONS.map((p) => p.label)).toEqual(rows.map((r) => r.label));
  });

  it("allows the same roles for every capability", () => {
    rows.forEach((row, i) => {
      const permission = PERMISSIONS[i];
      expect(permission?.allow, row.label).toEqual(row.allow);
    });
  });

  it("marks the same owner capabilities as needing 2FA", () => {
    rows.forEach((row, i) => expect(PERMISSIONS[i]?.ownerNeeds2fa, row.label).toBe(row.needs2fa));
  });
});

describe("the permission helpers", () => {
  it("ids are unique and every action maps to a known capability", () => {
    expect(new Set(PERMISSIONS.map((p) => p.id)).size).toBe(PERMISSIONS.length);
    for (const [action, id] of Object.entries(ACTION_PERMISSION)) {
      expect(PERMISSIONS.some((p) => p.id === id), action).toBe(true);
    }
  });

  it("covers every operation of architecture 8.3", () => {
    const markdown = currentArchitecture();
    const section = markdown.slice(markdown.indexOf("### 8.3 Mutations"), markdown.indexOf("### 8.4 Reads"));
    // First cell of each operation row: "leads.changeStage", "content.save, publish, ... (per entity)", "student.a, student.b".
    const named = section
      .split(/\r?\n/)
      .map((line) => /^\|\s*([a-z]+\.[^|]+?)\s*\|/.exec(line)?.[1])
      .filter((cell): cell is string => cell !== undefined)
      .flatMap((cell) => {
        const area = cell.split(".")[0] ?? "";
        return cell
          .replace(/\(per entity\)/, "")
          .split(",")
          .map((part) => part.trim())
          .map((part) => (part.includes(".") ? part : `${area}.${part}`));
      });
    expect(named.length).toBeGreaterThanOrEqual(24);
    for (const action of named) expect(Object.keys(ACTION_PERMISSION), action).toContain(action);
    // And nothing in the code is missing from the document.
    for (const action of Object.keys(ACTION_PERMISSION)) expect(named, action).toContain(action);
  });

  it("can and canDo answer from the table, and deny what is unknown", () => {
    expect(can("anonymous", "public.use")).toBe(true);
    expect(can("anonymous", "leads.work")).toBe(false);
    expect(can("student", "student.own")).toBe(true);
    expect(can("student", "leads.work")).toBe(false);
    expect(can("admin", "leads.work")).toBe(true);
    expect(can("admin", "team.manage")).toBe(false);
    expect(can("owner", "team.manage")).toBe(true);
    expect(can("owner", "does.not.exist")).toBe(false);
    expect(canDo("admin", "payments.record")).toBe(true);
    expect(canDo("admin", "settings.update")).toBe(false);
    expect(canDo("owner", "settings.update")).toBe(true);
    expect(canDo("student", "settings.update")).toBe(false);
  });

  it("lists the four roles the matrix is run under", () => {
    expect([...PERMISSION_ROLES]).toEqual(["anonymous", "student", "admin", "owner"]);
  });
});
