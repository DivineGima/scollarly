import { errorResponseFor, jsonResponse, newRequestId } from "@/lib/http";
import { plainUsd, parseUsdToCents, isFutureDate } from "./service";
import { csvFile } from "./csv";
import { leadSearchQuery, paymentsQuery, recordBody, voidBody } from "./schema";
import { uuidv7 } from "@/lib/uuid";
import { formatWat, watDateString } from "@/lib/time";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { exportPayments, listPayments, type PaymentFilter, recordPayment, searchLeadsForPayment, voidPayment } from "@/server/repositories/payments";

/**
 * The Payments screen (S9.1, S9.2; architecture 8.3, 10.6, 16 B9). Admins and the owner only: the facade is the first lock and the
 * database (policies, column grants and the guard trigger of migration 0011) the second. There is no edit operation, by design: a wrong
 * payment is voided with a reason and entered again.
 */

const invalid = (fields: Record<string, string>) => errorResponseFor("VALIDATION", "Check the filters.", newRequestId(), { fields });

function queryFields(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  return Object.fromEntries(issues.map((i) => [String(i.path[0] ?? "query"), i.message]));
}

/** A range the screen could not have produced (the end before the start) is refused, not silently reversed. */
function filterOf(data: { university?: string | undefined; from?: string | undefined; to?: string | undefined; status: "all" | "active" | "voided" }): PaymentFilter | Response {
  if (data.from && data.to && data.from > data.to) return invalid({ to: "INVALID" });
  return { status: data.status, ...(data.university ? { universityId: data.university } : {}), ...(data.from ? { from: data.from } : {}), ...(data.to ? { to: data.to } : {}) };
}

/** Postgres 23503: a foreign key points at a row that does not exist. `constraint` names which one when the driver reports it. */
function foreignKeyField(error: unknown): "leadId" | "universityId" | null {
  const e = error as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code !== "23503") return null;
  const constraint = String(e?.constraint ?? e?.cause?.constraint ?? "");
  return constraint.includes("lead") ? "leadId" : "universityId";
}

export const paymentMutations: Record<string, Mutation> = {
  /** B9 steps 2 to 3. Validation first, then one statement: the row and its audit entry, once per submission token. */
  "admin/payments.record": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(recordBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const input = parsed.value;
      const cents = parseUsdToCents(input.amount);
      if (cents === null) return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { amount: "INVALID" } });
      if (isFutureDate(input.receivedOn, env.now())) {
        return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { receivedOn: "FUTURE_DATE" } });
      }
      try {
        const outcome = await recordPayment(env.db, actor as Actor, {
          id: uuidv7(env.now().getTime()),
          submissionToken: input.submissionToken,
          universityId: input.universityId,
          leadId: input.leadId ?? null,
          amountUsdCents: cents,
          receivedOn: input.receivedOn,
          note: input.note && input.note !== "" ? input.note : null,
        });
        if (outcome.kind === "token_reused") return errorResponseFor("CONFLICT", "This form was already used. Reload the page to enter another payment.", requestId);
        return jsonResponse({ id: outcome.id, status: outcome.kind }, outcome.kind === "created" ? 201 : 200);
      } catch (error) {
        const field = foreignKeyField(error);
        if (field) return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { [field]: "UNKNOWN_VALUE" } });
        throw error;
      }
    },
  },

  /** B9 steps 4 to 5. The reason is required (also by a CHECK in the database). A voided payment cannot be voided again. */
  "admin/payments.void": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(voidBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await voidPayment(env.db, actor as Actor, parsed.value.id, parsed.value.reason);
      if (outcome === "not_found") return errorResponseFor("NOT_FOUND", "That payment does not exist.", requestId);
      if (outcome === "already_voided") return errorResponseFor("CONFLICT", "That payment was already voided. Reload the page.", requestId);
      return jsonResponse({ voided: true });
    },
  },
};

const HEADER = ["Date received", "University", "Amount (USD)", "Linked lead", "Entered by", "Entered at (WAT)", "Status", "Void reason", "Note"] as const;

export function paymentDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** B9 step 1: the totals, the rows, and what the record form needs. */
    "admin/payments": async (actor, call) => {
      const parsed = paymentsQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(queryFields(parsed.error.issues));
      const filter = filterOf(parsed.data);
      if (filter instanceof Response) return filter;
      const list = await listPayments(env.db, actor, filter);
      return { ...list, today: watDateString(env.now()) };
    },

    /** B9 step 2: the lead picker. */
    "admin/payment-leads": async (actor, call) => {
      const parsed = leadSearchQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(queryFields(parsed.error.issues));
      return { leads: await searchLeadsForPayment(env.db, actor, parsed.data.q) };
    },

    /** B9 step 6: the same filters as the screen, as a file. Cells that could run as a formula are neutralised (`csv.ts`). */
    "admin/payments-csv": async (actor, call) => {
      const parsed = paymentsQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(queryFields(parsed.error.issues));
      const filter = filterOf(parsed.data);
      if (filter instanceof Response) return filter;
      const { rows, truncated } = await exportPayments(env.db, actor, filter);
      if (truncated) return errorResponseFor("PAYLOAD_TOO_LARGE", "Too many payments for one file. Narrow the dates.", newRequestId());
      const file = csvFile(
        HEADER,
        rows.map((r) => [
          r.receivedOn,
          r.universityName,
          plainUsd(r.amountUsdCents),
          r.leadRef ?? "",
          r.enteredByEmail ?? "",
          formatWat(new Date(r.enteredAt)),
          r.voidedAt ? "Voided" : "Recorded",
          r.voidReason ?? "",
          r.note ?? "",
        ]),
      );
      return new Response(file, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="payments-${watDateString(env.now())}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    },
  };
}
