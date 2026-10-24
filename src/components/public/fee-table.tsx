"use client";

import { useMemo, useState } from "react";
import { PageLink } from "./page-link";

export interface FeeRowItem {
  slug: string;
  name: string;
  /** Confirmed lines, already worded: "USD 3,000 – 6,000" and its period. Empty means "Contact us" (FR-2). */
  lines: { id: string; currency: string; range: string; period: string; updated: string }[];
}

export interface FeeTableLabels {
  university: string;
  fee: string;
  /** Contains `{date}`. */
  updated: string;
  contactUs: string;
  filterCurrency: string;
  all: string;
  disclaimer: string;
}

/**
 * The fee comparison (architecture 16 A4). Universities with a confirmed fee show their ranges; the others show
 * "Contact us". Currencies are listed side by side and never added together (FR-2). The currency chips narrow the table
 * in the browser; without JavaScript every row is visible.
 */
export function FeeTable({ rows, currencies, labels }: { rows: FeeRowItem[]; currencies: string[]; labels: FeeTableLabels }) {
  const [currency, setCurrency] = useState<string | null>(null);
  const shown = useMemo(
    () =>
      rows
        .map((row) => ({ ...row, lines: currency ? row.lines.filter((l) => l.currency === currency) : row.lines }))
        .filter((row) => !currency || row.lines.length > 0),
    [rows, currency],
  );

  return (
    <div>
      {currencies.length > 1 ? (
        <div role="group" aria-label={labels.filterCurrency} className="chips js-only">
          <button type="button" className="chip" aria-pressed={currency === null} onClick={() => setCurrency(null)}>
            {labels.all}
          </button>
          {currencies.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={currency === c} onClick={() => setCurrency(currency === c ? null : c)}>
              {c}
            </button>
          ))}
        </div>
      ) : null}
      <div className="table-wrap" role="region" aria-label={labels.fee} tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{labels.university}</th>
              <th scope="col">{labels.fee}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.slug}>
                <th scope="row">
                  <a href={`/universities/${row.slug}`}>{row.name}</a>
                </th>
                <td>
                  {row.lines.length === 0 ? (
                    <PageLink href="/contact">{labels.contactUs}</PageLink>
                  ) : (
                    <ul className="plain">
                      {row.lines.map((line) => (
                        <li key={line.id}>
                          <strong>{line.range}</strong> <span className="muted">{line.period}</span>
                          <span className="muted block">{labels.updated.replace("{date}", line.updated)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{labels.disclaimer}</p>
    </div>
  );
}
