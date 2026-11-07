/** Fired on `window` after "Mark all read", so the bar's dot follows without a reload. */
export const NOTIFICATIONS_CHANGED_EVENT = "scollarly:notifications-changed";

/** Fired on `window` when the staff count rose, so an open Inbox section fetches itself again without a reload (architecture 24.10). */
export const INBOX_REFRESH_EVENT = "scollarly:inbox-refresh";
