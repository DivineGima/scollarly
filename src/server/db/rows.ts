/** Raw `execute` results are an array on the Neon HTTP driver and `{ rows }` on the WebSocket and node-postgres drivers. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
