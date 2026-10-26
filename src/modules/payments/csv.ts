/**
 * CSV export of the ledger (architecture 13.1, 16 B9 step 6). A spreadsheet runs a cell that starts with `=`, `+`, `-` or `@` as a
 * formula, and a payment note or a university name is typed by a person, so such a cell is prefixed with a single quote and opens as
 * text. A tab or a carriage return at the start is treated the same way (some spreadsheets strip it and then read a formula).
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

/** A byte order mark first, so Excel reads the file as UTF-8; lines end with CRLF as RFC 4180 asks. */
export function csvFile(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `﻿${[csvLine(header), ...rows.map(csvLine)].join("\r\n")}\r\n`;
}
