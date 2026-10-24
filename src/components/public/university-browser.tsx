"use client";

import { useMemo, useState } from "react";

export interface UniversityCardItem {
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  type: string | null;
  naacGrade: string | null;
  logo: { src: string; width: number; height: number; alt: string } | null;
  /** Already worded, for example "Fees from USD 3,000 tuition per year", or the "to be confirmed" line. Never 0 or blank (FR-2). */
  feeText: string;
  levels: string[];
}

export interface UniversityBrowserLabels {
  search: string;
  searchPlaceholder: string;
  filterLevel: string;
  filterCity: string;
  all: string;
  noMatch: string;
  results: string;
  naac: string;
}

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/**
 * The universities list (architecture 16 A2). The full list is in the HTML, so it works without JavaScript; with
 * JavaScript the search box and the chips narrow it instantly from the data already loaded (no request).
 */
export function UniversityBrowser({ items, labels }: { items: UniversityCardItem[]; labels: UniversityBrowserLabels }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);

  const levels = useMemo(() => [...new Set(items.flatMap((i) => i.levels))].sort(), [items]);
  const cities = useMemo(() => [...new Set(items.flatMap((i) => (i.city ? [i.city] : [])))].sort(), [items]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!needle || `${item.name} ${item.city ?? ""} ${item.state ?? ""}`.toLowerCase().includes(needle)) &&
        (!level || item.levels.includes(level)) &&
        (!city || item.city === city),
    );
  }, [items, query, level, city]);

  return (
    <div>
      {items.length > 1 ? (
        <div className="filters js-only">
          <label className="field">
            <span>{labels.search}</span>
            <input type="search" value={query} placeholder={labels.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          </label>
          <Chips label={labels.filterLevel} all={labels.all} options={levels} value={level} onChange={setLevel} />
          <Chips label={labels.filterCity} all={labels.all} options={cities.length > 1 ? cities : []} value={city} onChange={setCity} />
        </div>
      ) : null}
      <p className="muted" role="status" aria-live="polite">
        {fill(labels.results, { count: shown.length })}
      </p>
      {shown.length === 0 ? (
        <p>{labels.noMatch}</p>
      ) : (
        <ul className="grid cards">
          {shown.map((item) => (
            <li key={item.slug} className="card">
              <a href={`/universities/${item.slug}`} className="card-link">
                <span className="card-head">
                  {item.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- our own stored image (architecture 6.5)
                    <img src={item.logo.src} width={item.logo.width} height={item.logo.height} alt={item.logo.alt} loading="lazy" decoding="async" className="logo" />
                  ) : (
                    <span className="logo logo-placeholder" aria-hidden="true">
                      {item.name.slice(0, 1)}
                    </span>
                  )}
                  <span>
                    <strong>{item.name}</strong>
                    <span className="muted block">{[item.city, item.state].filter(Boolean).join(", ")}</span>
                  </span>
                </span>
                <span className="badges">
                  {item.type ? <span className="badge">{item.type}</span> : null}
                  {item.naacGrade ? <span className="badge">{fill(labels.naac, { grade: item.naacGrade })}</span> : null}
                </span>
                <span className="fee-line">{item.feeText}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chips({ label, all, options, value, onChange }: { label: string; all: string; options: string[]; value: string | null; onChange: (value: string | null) => void }) {
  if (options.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="chips">
      <button type="button" className="chip" aria-pressed={value === null} onClick={() => onChange(null)}>
        {all}
      </button>
      {options.map((option) => (
        <button key={option} type="button" className="chip" aria-pressed={value === option} onClick={() => onChange(value === option ? null : option)}>
          {option}
        </button>
      ))}
    </div>
  );
}
