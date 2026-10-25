/**
 * One structured line per server fault (architecture 13.4), read in Workers Logs (`observability` in wrangler.jsonc). The line carries the
 * request id the client was given, the route and the class of the error, so a reported id can be traced. It never carries the message or
 * the stack: a database error message can hold connection details or row values, and personal data is never logged (CLAUDE.md).
 * The only extra field is the SQLSTATE code (`42501` permission denied, `08006` connection failure), which names a class of fault.
 */
export function logError(requestId: string, route: string, error: unknown): void {
  const code = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : undefined;
  console.error(JSON.stringify({ level: "error", requestId, route, error: error instanceof Error ? error.name : typeof error, ...(code ? { code } : {}) }));
}
