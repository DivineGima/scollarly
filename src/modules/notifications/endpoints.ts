import { jsonResponse } from "@/lib/http";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { markNotificationsSeen, staffNotifications, studentNotifications, type NotificationList } from "@/server/repositories/notifications";

/**
 * Notifications (S13.5, architecture 21.4, 21.8): `GET me/notifications` and `GET admin/notifications` (with `?count=1` they answer only the unread
 * number, which the bar's dot uses), and "Mark all read" as a plain mutation. Who may call is decided by the area (a student for `me`, an admin or the
 * owner for `admin`) and by the facade; what each person sees is decided by row level security under the queries.
 *
 * The seen mutation is named \`notifications.seen\`, not \`notifications-seen\`: an operation name may hold letters, digits and dots, not a hyphen.
 */

const answer = (list: NotificationList, call: { url: URL }) => (call.url.searchParams.get("count") === "1" ? { unread: list.unread } : list);

export function notificationDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    "me/notifications": async (actor, call) => answer(await studentNotifications(env.db, actor, env.now()), call),
    "admin/notifications": async (actor, call) => answer(await staffNotifications(env.db, actor, env.now()), call),
  };
}

export const notificationMutations: Record<string, Mutation> = {
  "me/notifications.seen": {
    access: { kind: "signed-in" },
    async handle({ actor, env }) {
      await markNotificationsSeen(env.db, actor as Actor);
      return jsonResponse({ seen: true });
    },
  },
  "admin/notifications.seen": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env }) {
      await markNotificationsSeen(env.db, actor as Actor);
      return jsonResponse({ seen: true });
    },
  },
};
