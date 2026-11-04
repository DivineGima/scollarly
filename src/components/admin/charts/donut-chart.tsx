import type { BarRow } from "./bar-chart";

export interface DonutChartProps {
  rows: readonly BarRow[];
  caption: string;
  /** The word under the total in the middle, for example "leads". */
  totalLabel: string;
  columns: { label: string; value: string };
  empty: string;
  id: string;
}

const SIZE = 120;
const CENTRE = SIZE / 2;
const RADIUS = 44;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The arcs of a donut: each slice's length and where it starts, in the units of the circle's dash. Pure, so it is tested without a browser. */
export function donutArcs(values: readonly number[]): { length: number; offset: number }[] {
  const total = values.reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
  let used = 0;
  return values.map((value) => {
    const part = total > 0 && value > 0 ? (value / total) * CIRCUMFERENCE : 0;
    const arc = { length: part, offset: -used };
    used += part;
    return arc;
  });
}

/**
 * A hand-built donut (PRD_3 F18 amended, ADR-057): plain SVG, no library. The slices are told apart by position and by the legend, which writes
 * every number out, so colour is never the only signal. Zero slices draw nothing; an empty chart says so instead of drawing a ring.
 * Server-safe: no hooks, no browser APIs.
 */
export function DonutChart({ rows, caption, totalLabel, columns, empty, id }: DonutChartProps) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.length === 0 || total === 0) {
    return (
      <figure className="donut-chart" data-empty="true">
        <figcaption>{caption}</figcaption>
        <p className="bar-chart-empty">{empty}</p>
      </figure>
    );
  }
  const arcs = donutArcs(rows.map((row) => row.value));
  return (
    <figure className="donut-chart" aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`}>{caption}</figcaption>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-labelledby={`${id}-caption`} className="donut-chart-svg">
        <g transform={`rotate(-90 ${CENTRE} ${CENTRE})`}>
          {rows.map((row, index) =>
            arcs[index] && arcs[index].length > 0 ? (
              <circle
                key={row.key}
                cx={CENTRE}
                cy={CENTRE}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${arcs[index].length} ${CIRCUMFERENCE - arcs[index].length}`}
                strokeDashoffset={arcs[index].offset}
                className={`donut-slice donut-slice-${index % 6}`}
              />
            ) : null,
          )}
        </g>
        <text x={CENTRE} y={CENTRE - 2} textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x={CENTRE} y={CENTRE + 12} textAnchor="middle" className="donut-total-label">
          {totalLabel}
        </text>
      </svg>
      <ul className="donut-legend">
        {rows.map((row, index) => (
          <li key={row.key}>
            <span className={`donut-key donut-key-${index % 6}`} aria-hidden="true" />
            {row.label}: <strong>{row.value}</strong>
            {row.note ? <span className="bar-chart-note"> · {row.note}</span> : null}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{columns.label}</th>
            <th scope="col">{columns.value}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
