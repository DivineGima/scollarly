import type { Role } from "./actor";

/**
 * The permission matrix (architecture 9.5) as data. The architecture table is the source: a unit test parses it from
 * the current `system_architecture_N.md` and fails if this file and the document disagree, and the authorisation
 * matrix harness (tests/integration/authz-matrix.test.ts) calls every protected action under every role and compares
 * the result with this table.
 *
 * "Owner" here means an owner whose session passed the 2FA check. An owner without it is treated as a student by the
 * facade (`effectiveRole`, architecture 9.3), so this table never needs a separate row for them.
 */

export type PermissionRole = "anonymous" | Role;
export const PERMISSION_ROLES: readonly PermissionRole[] = ["anonymous", "student", "admin", "owner"];

export interface Permission {
  /** A stable id used by the action registry and the tests. */
  id: string;
  /** The first column of the 9.5 table, word for word. */
  label: string;
  allow: Readonly<Record<PermissionRole, boolean>>;
  /** The table marks the owner column "(2FA)": the owner needs a 2FA-verified session. */
  ownerNeeds2fa: boolean;
}

const allow = (anonymous: boolean, student: boolean, admin: boolean, owner: boolean) => ({ anonymous, student, admin, owner });

export const PERMISSIONS = [
  { id: "public.use", label: "Read public pages, create lead, send events", allow: allow(true, true, true, true), ownerNeeds2fa: false },
  { id: "student.own", label: "Own progress, profile, link request, export, erasure", allow: allow(false, true, true, true), ownerNeeds2fa: false },
  { id: "leads.work", label: "View and work all leads (stage, assign, note, reply)", allow: allow(false, false, true, true), ownerNeeds2fa: false },
  { id: "content.manage", label: "Content CRUD, publish, media upload", allow: allow(false, false, true, true), ownerNeeds2fa: false },
  { id: "payments.manage", label: "Record, void and view payments", allow: allow(false, false, true, true), ownerNeeds2fa: false },
  { id: "analytics.view", label: "Funnel and source analytics", allow: allow(false, false, true, true), ownerNeeds2fa: false },
  { id: "performance.own", label: "Own performance view", allow: allow(false, false, true, true), ownerNeeds2fa: false },
  { id: "performance.all", label: "All-admin performance", allow: allow(false, false, false, true), ownerNeeds2fa: false },
  { id: "team.manage", label: "Invite, remove, change roles", allow: allow(false, false, false, true), ownerNeeds2fa: true },
  { id: "owner.pages", label: "Settings, audit log, security, health", allow: allow(false, false, false, true), ownerNeeds2fa: true },
] as const satisfies readonly Permission[];

export type PermissionId = (typeof PERMISSIONS)[number]["id"];

/**
 * Every mutation of architecture 8.3 and the capability that guards it. A stage that builds an operation adds its test
 * to the harness; until then the harness lists it as not implemented.
 */
export const ACTION_PERMISSION = {
  "leads.changeStage": "leads.work",
  "leads.assign": "leads.work",
  "leads.addNote": "leads.work",
  "leads.logReply": "leads.work",
  "leads.logAdminWhatsAppOpen": "leads.work",
  "leads.resolveDuplicate": "leads.work",
  "leads.decideClaim": "leads.work",
  "leads.eraseLead": "leads.work",
  "content.save": "content.manage",
  "content.publish": "content.manage",
  "content.unpublish": "content.manage",
  "content.archive": "content.manage",
  "content.restore": "content.manage",
  "media.upload": "content.manage",
  "media.archive": "content.manage",
  "payments.record": "payments.manage",
  "payments.void": "payments.manage",
  "team.invite": "team.manage",
  "team.revokeInvite": "team.manage",
  "team.removeAdmin": "team.manage",
  "team.changeRole": "team.manage",
  "settings.update": "owner.pages",
  "student.requestErasure": "student.own",
  "student.exportData": "student.own",
  "student.requestLink": "student.own",
} as const satisfies Record<string, PermissionId>;

export type ActionId = keyof typeof ACTION_PERMISSION;

export function permissionById(id: string): Permission {
  const permission = (PERMISSIONS as readonly Permission[]).find((p) => p.id === id);
  if (!permission) throw new Error(`Unknown permission ${id}`);
  return permission;
}

/** Whether `role` (an effective role, or `anonymous`) may use the capability. Unknown capabilities are denied. */
export function can(role: PermissionRole, id: string): boolean {
  const permission = (PERMISSIONS as readonly Permission[]).find((p) => p.id === id);
  return permission ? permission.allow[role] : false;
}

/** Whether `role` may perform this operation. */
export function canDo(role: PermissionRole, action: ActionId): boolean {
  return can(role, ACTION_PERMISSION[action]);
}
