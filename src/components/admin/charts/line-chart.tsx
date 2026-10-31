export interface LinePoint {
  label: string;
  value: number;
}

export interface LineChartProps {
  points: readonly LinePoint[];
  /** One line saying what the chart shows (FR-22: no chart without an explanation). It is also the chart's accessible name. */
  caption: string;
  /** The column headings of the text alternative: what a point is called and what its value counts. */
  columns: { label: string; value: string };
  /** What to show when there is nothing to draw. */
  empty: string;
  /** Formats a day label for the axis; defaults to the day of the month. */
  axisLabel?: (label: string) => string;
}

const WIDTH = 320;
const HEIGHT = 120;
const PAD = { top: 8, right: 8, bottom: 20, left: 24 };

/** A "nice" top for the scale: 4 for 3, 10 for 8, 20 for 14, so the grid lines land on round numbers. */
export function niceMax(max: number): number {
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= max) return step * magnitude;
  return 10 * magnitude;
}

/**
 * A small hand-built line chart (architecture 21.9, ADR-046): plain SVG, no library, so it adds nothing to the bundle and costs no CPU on the
 * server. It has a caption (its accessible name) and a data table for screen readers, and it draws nothing misleading when every value is zero.
 * Server-safe: no hooks, no browser APIs.
 */
export function LineChart({ points, caption, columns, empty, axisLabel = (label) => label.slice(8) }: LineChartProps) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  if (points.length === 0 || total === 0) {
    return (
      <figure className="line-chart" data-empty="true">
        <figcaption>{caption}</figcaption>
        <p className="line-chart-empty">{empty}</p>
      </figure>
    );
  }
  const top = niceMax(Math.max(...points.map((p) => p.value)));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [0, top / 2, top];
  // At most about five day labels, whatever the period.
  const every = Math.max(1, Math.ceil(points.length / 5));

  return (
    <figure className="line-chart">
      <figcaption id="line-chart-caption">{caption}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="line-chart-caption" className="line-chart-svg" preserveAspectRatio="xMidYMid meet">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="line-chart-grid" />
            <text x={PAD.left - 4} y={y(tick) + 3} textAnchor="end" className="line-chart-tick">
              {Number.isInteger(tick) ? tick : tick.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={path} className="line-chart-line" fill="none" />
        {points.map((p, i) => (
          <circle key={p.label} cx={x(i)} cy={y(p.value)} r={2.5} className="line-chart-dot" />
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={`l-${p.label}`} x={x(i)} y={HEIGHT - 6} textAnchor="middle" className="line-chart-tick">
              {axisLabel(p.label)}
            </text>
          ) : null,
        )}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{columns.label}</th>
            <th scope="col">{columns.value}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
