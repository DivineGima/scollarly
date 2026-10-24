/**
 * A typed result (architecture 13.4): services return `Result` values instead of throwing for expected failures,
 * and the API layer maps them to the one error envelope. Unexpected failures still throw.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Returns the value, or throws. For tests and for places where a failure is a programming error. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap on an Err: ${typeof result.error === "string" ? result.error : JSON.stringify(result.error)}`);
}
