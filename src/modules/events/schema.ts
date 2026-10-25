import * as z from "zod";
import { EVENT_TYPES } from "@/lib/constants";
import { PAGE_GROUPS } from "@/lib/page-group";
import { REF_PATTERN } from "@/lib/ref";
import { isoDateTimeSchema, uuidSchema } from "@/lib/schemas/common";

/**
 * The body of `POST /api/v1/events` (architecture 8.2): a batch of at most 50 events. Unknown fields are rejected, and the
 * server ignores any country the client might send, because there is no such field: the country comes from the edge request.
 * An event can carry no name, number or email; the only identifier is a lead reference on a `wa_tap`.
 */
export const MAX_EVENTS_PER_BATCH = 50;

export const eventItemSchema = z.strictObject({
  type: z.enum(EVENT_TYPES),
  session_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  lead_ref: z.string().regex(REF_PATTERN).optional(),
  university_id: uuidSchema.optional(),
  page_group: z.enum(PAGE_GROUPS).optional(),
  occurred_at: isoDateTimeSchema.optional(),
});

export const eventsBodySchema = z.strictObject({
  events: z.array(eventItemSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

export type EventItem = z.infer<typeof eventItemSchema>;
