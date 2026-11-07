import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart } from "@/components/admin/charts/bar-chart";
import { DonutChart, donutArcs } from "@/components/admin/charts/donut-chart";
import { daysBetween, exportAllowed } from "@/modules/crm/endpoints";
import { filtersToQuery, readCrmFilters } from "@/modules/crm/filters";
import { csvCell, csvLine, formatMinutes, funnelFromStages, percentOf, toCsv, topSlices } from "@/modules/crm/metrics";

const NOW = new Date("2026-10-26T12:00:00Z");
const read = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

describe("S14.7: the CRM numbers", () => {
  it("gives a whole percent and never 0 percent of nothing", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 5)).toBe(0);
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(Number.NaN, 4)).toBeNull();
  });

  it("keeps the biggest slices, groups the rest as other, and drops zeros", () => {
    const rows = [{ key: "NG", count: 5 }, { key: "CM", count: 9 }, { key: "GH", count: 0 }, { key: "SN", count: 2 }, { key: "ZA", count: 2 }, { key: "CI", count: 1 }];
    expect(topSlices(rows, 3)).toEqual([{ key: "CM", count: 9 }, { key: "NG", count: 5 }, { key: "SN", count: 2 }, { key: "other", count: 3 }]);
    expect(topSlices(rows, 10).map((r) => r.key)).toEqual(["CM", "NG", "SN", "ZA", "CI"]);
    expect(topSlices([], 3)).toEqual([]);
  });

  it("builds the funnel from current stages: a lead at a later stage has passed the earlier ones", () => {
    const steps = funnelFromStages([
      { code: "visa", position: 5, count: 1 },
      { code: "documents", position: 1, count: 6 },
      { code: "offer_letter", position: 3, count: 2 },
      { code: "course_interest", position: 2, count: 3 },
    ]);
    expect(steps.map((s) => [s.code, s.reached])).toEqual([["documents", 12], ["course_interest", 6], ["offer_letter", 3], ["visa", 1]]);
    expect(steps[0]).toMatchObject({ ofAll: 100, ofPrevious: null });
    expect(steps[1]).toMatchObject({ ofAll: 50, ofPrevious: 50 });
    expect(steps[3]).toMatchObject({ ofAll: 8, ofPrevious: 33 });
    expect(funnelFromStages([{ code: "a", position: 1, count: 0 }])[0]).toMatchObject({ reached: 0, ofAll: null });
  });

  it("words a response time in minutes, hours or days, and leaves nothing as null", () => {
    expect(formatMinutes(null)).toBeNull();
    expect(formatMinutes(-5)).toBeNull();
    expect(formatMinutes(0.2)).toEqual({ unit: "minutes", value: 1 });
    expect(formatMinutes(45)).toEqual({ unit: "minutes", value: 45 });
    expect(formatMinutes(90)).toEqual({ unit: "hours", value: 1.5 });
    expect(formatMinutes(60 * 72)).toEqual({ unit: "days", value: 3 });
  });
});

describe("S14.7: the CSV file is safe to open in a spreadsheet", () => {
  it("quotes commas, quotes and line breaks, and defuses a formula", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    for (const bad of ["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"]) expect(csvCell(bad).startsWith("'") || csvCell(bad).startsWith('"\'')).toBe(true);
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(new Date("2026-10-26T12:00:00Z"))).toBe("2026-10-26T12:00:00.000Z");
    expect(csvLine(["a", 1, null])).toBe("a,1,");
  });

  it("starts with a byte order mark, uses Windows line ends and ends with one", () => {
    const file = toCsv(["a", "b"], [["1", "2"], ["=x", "y"]]);
    expect(file.startsWith("﻿")).toBe(true);
    expect(file).toBe("﻿a,b\r\n1,2\r\n'=x,y\r\n");
  });
});

describe("S14.7: the filters", () => {
  const params = (text: string) => new URLSearchParams(text);

  it("defaults to the last 30 days, everyone, no country and no source", () => {
    const result = readCrmFilters(params(""), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters).toMatchObject({ country: null, source: null, assigned: "all" });
    expect(result.filters.range.to).toBe("2026-10-26");
    expect(result.filters.range.from).toBe("2026-09-27");
  });

  it("reads each filter", () => {
    const result = readCrmFilters(params("from=2026-10-01&to=2026-10-10&country=NG&source=%2Fapply&assigned=me"), NOW);
    expect(result.ok && result.filters).toMatchObject({ country: "NG", source: "/apply", assigned: "me" });
  });

  it("names the field when a value could not have come from the screen", () => {
    for (const [query, field] of [["country=XX", "country"], ["assigned=everyone", "assigned"], ["source=a b", "source"], ["from=2026-02-30", "from"], ["to=2099-01-01", "to"], ["from=2026-10-10&to=2026-10-01", "from"], ["from=2020-01-01", "from"], ["surprise=1", "query"]] as const) {
      const result = readCrmFilters(params(query), NOW);
      expect(result.ok, query).toBe(false);
      if (!result.ok) expect(Object.keys(result.fields), query).toContain(field);
    }
  });

  it("turns filters back into a query string without empty values", () => {
    expect(filtersToQuery({ from: "2026-10-01", country: "", assigned: "me" })).toBe("?from=2026-10-01&assigned=me");
    expect(filtersToQuery({})).toBe("");
  });

  it("lists every WAT day of a range, oldest first", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(daysBetween("2026-10-26", "2026-10-26")).toEqual(["2026-10-26"]);
    expect(daysBetween("bad", "2026-10-26")).toEqual([]);
  });
});

describe("S14.7: the export brake", () => {
  it("allows five exports in ten minutes for one person and then waits, per person", () => {
    const start = 1_000_000;
    for (let i = 0; i < 5; i += 1) expect(exportAllowed("u-brake", start + i)).toBe(true);
    expect(exportAllowed("u-brake", start + 10)).toBe(false);
    expect(exportAllowed("someone-else", start + 10)).toBe(true);
    expect(exportAllowed("u-brake", start + 10 * 60_000 + 100)).toBe(true);
  });
});

describe("S14.7: the charts", () => {
  const columns = { label: "Name", value: "Leads" };

  it("draws a bar chart with every number written out and a table for screen readers", () => {
    const html = renderToStaticMarkup(createElement(BarChart, { id: "t", rows: [{ key: "a", label: "Cameroon", value: 8 }, { key: "b", label: "Ghana", value: 2, note: "hi" }], caption: "Leads by country", columns, empty: "Nothing" }));
    expect(html).toContain("Leads by country");
    expect(html).toContain("Cameroon");
    expect(html).toContain("width:100%");
    expect(html).toContain("width:25%");
    expect(html).toContain("<table");
    expect(html).not.toContain("<script");
  });

  it("says so instead of drawing an empty chart", () => {
    const html = renderToStaticMarkup(createElement(BarChart, { id: "t", rows: [{ key: "a", label: "A", value: 0 }], caption: "C", columns, empty: "Nothing to show" }));
    expect(html).toContain("Nothing to show");
    expect(html).not.toContain("bar-chart-bar");
  });

  it("splits the circle in proportion, skips zero slices and never runs past the full circle", () => {
    const arcs = donutArcs([1, 1, 2, 0]);
    const total = arcs.reduce((sum, arc) => sum + arc.length, 0);
    expect(total).toBeCloseTo(2 * Math.PI * 44, 5);
    expect(arcs[2]?.length).toBeCloseTo(arcs[0]!.length * 2, 5);
    expect(arcs[3]?.length).toBe(0);
    expect(donutArcs([0, 0]).every((arc) => arc.length === 0)).toBe(true);
  });

  it("draws a donut with a legend that names every number", () => {
    const html = renderToStaticMarkup(createElement(DonutChart, { id: "d", rows: [{ key: "a", label: "Share results", value: 3 }, { key: "b", label: "Visa", value: 1 }], caption: "By stage", totalLabel: "leads", columns, empty: "Nothing" }));
    expect(html).toContain("Share results");
    expect(html).toContain("<strong>3</strong>");
    expect(html).toContain(">4<");
  });
});

describe("S14.7: the screens are wired and carry no personal data", () => {
  it("adds the overview to Insights and the pipeline to Leads", () => {
    const hubs = read("src/components/admin/hubs.tsx");
    expect(hubs).toMatch(/CrmOverview/);
    expect(hubs).toMatch(/PipelineBoard/);
  });

  it("keeps the chart code out of every public route", () => {
    for (const file of ["src/app/[locale]/(public)/page.tsx", "src/components/public/client-shell.tsx"]) {
      expect(read(file), file).not.toMatch(/admin\/charts|admin\/crm/);
    }
  });

  it("exports references and timing only: no name, number or email column", () => {
    const source = read("src/modules/crm/endpoints.ts");
    const header = /const header = \[(.*?)\];/s.exec(source)?.[1] ?? "";
    expect(header).toContain("reference");
    expect(header).not.toMatch(/name|whatsapp|phone|email|number/i);
    const repo = read("src/server/repositories/crm.ts");
    const exportSql = repo.slice(repo.indexOf("export async function exportLeads"));
    expect(exportSql).not.toMatch(/l\.name|whatsapp_e164|l\.email/);
  });
});
