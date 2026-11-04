export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** A short note after the value, for example "42 % of leads". Plain text. */
  note?: string;
}

export interface BarChartProps {
  rows: readonly BarRow[];
  /** One line saying what the chart shows (FR-22). It is also the chart's accessible name. */
  caption: string;
  columns: { label: string; value: string };
  empty: string;
  /** Used to make the id unique when several charts are on one screen. */
  id: string;
}

/**
 * A hand-built horizontal bar chart (PRD_3 F18 amended, ADR-057): plain SVG-free markup, so no library and no script. Each bar's length is its
 * share of the largest value; a value of zero draws no bar and says 0. It has a caption and the numbers are written out next to every bar, so
 * nothing depends on colour or on seeing the picture. Server-safe: no hooks, no browser APIs.
 */
export function BarChart({ rows, caption, columns, empty, id }: BarChartProps) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (rows.length === 0 || max === 0) {
    return (
      <figure className="bar-chart" data-empty="true">
        <figcaption>{caption}</figcaption>
        <p className="bar-chart-empty">{empty}</p>
      </figure>
    );
  }
  return (
    <figure className="bar-chart" aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`}>{caption}</figcaption>
      <ul className="bar-chart-list">
        {rows.map((row) => (
          <li key={row.key} className="bar-chart-row">
            <span className="bar-chart-label">{row.label}</span>
            <span className="bar-chart-track" aria-hidden="true">
              <span className="bar-chart-bar" style={{ width: `${Math.max(row.value > 0 ? 2 : 0, Math.round((row.value / max) * 100))}%` }} />
            </span>
            <span className="bar-chart-value">
              {row.value}
              {row.note ? <span className="bar-chart-note"> · {row.note}</span> : null}
            </span>
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
