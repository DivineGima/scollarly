import type { ZodType } from "zod";
import { validationErrorResponse } from "@/lib/http";

export type Parsed<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Validates a request body against a Zod schema. Use `z.strictObject`, so an unknown field is refused (architecture 8.1). */
export function parseBody<T>(schema: ZodType<T>, body: unknown, requestId: string): Parsed<T> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, response: validationErrorResponse(result.error.issues, requestId) };
}
