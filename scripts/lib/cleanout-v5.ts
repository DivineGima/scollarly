/**
 * The one-time clean-out of tracker_5 flag F41 (owner decision 2026-11-07; CLAUDE.md guardrail exception (b)): every account except the owner's, with
 * their data, goes before the version 5 roles are introduced, so the new managers and the second admin start from a clean list.
 *
 * It is a script, not a migration: it runs once, by hand, on a database that has first been snapshotted and rehearsed on a branch. It always runs inside ONE
 * transaction and is rolled back unless `confirm` is true, so a dry run shows the exact counts without changing anything.
 *
 * What goes: the other accounts (Neon Auth user, sessions, accounts, app user, second-factor rows, student profile), the leads they own or were
 * assigned (with notes, history, programme choices, claims, duplicate decisions, data requests and the placement payments recorded against them).
 * What stays: the owner's account and rows, the content, the settings, the audit log (it records who did what; it holds ids only), the anonymous
 * event counts (their link to a deleted lead is cleared), and any lead that belongs to no account at all unless `includeUnlinkedLeads` is true.
 *
 * It works before migration 0022 (the keeper's role is `owner`) and after it (`admin`).
 */

export interface Sql {
  (statement: string): Promise<Record<string, unknown>[]>;
}

export interface CleanOutOptions {
  /** The email of the one account to keep. Must exist, be verified, and be the owner (or, after migration 0022, an admin). */
  keepEmail: string;
  /** False (the default) rolls everything back: a dry run. */
  confirm: boolean;
  /** Also delete leads that belong to no account. Off by default: they are shown in the counts and left alone. */
  includeUnlinkedLeads?: boolean;
  /** Also delete placement payments that are not tied to a lead (the owner's two test records). Off by default. */
  includeAllPayments?: boolean;
}

export interface CleanOutReport {
  keptUserId: string;
  keptRole: string;
  committed: boolean;
  before: Record<string, number>;
  deleted: Record<string, number>;
  after: Record<string, number>;
}

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const COUNTED = ["neon_auth_user", "app_user", "student_profile", "lead", "lead_unlinked", "lead_note", "lead_activity", "lead_claim", "lead_programme_pref", "lead_duplicate_decision", "data_request", "placement_payment", "owner_totp", "recovery_code", "step_up"] as const;

async function counts(sql: Sql): Promise<Record<string, number>> {
  const [row] = await sql(`
    select (select count(*) from neon_auth."user") as neon_auth_user,
           (select count(*) from public.app_user) as app_user,
           (select count(*) from public.student_profile) as student_profile,
           (select count(*) from public.lead) as lead,
           (select count(*) from public.lead where user_id is null) as lead_unlinked,
           (select count(*) from public.lead_note) as lead_note,
           (select count(*) from public.lead_activity) as lead_activity,
           (select count(*) from public.lead_claim) as lead_claim,
           (select count(*) from public.lead_programme_pref) as lead_programme_pref,
           (select count(*) from public.lead_duplicate_decision) as lead_duplicate_decision,
           (select count(*) from public.data_request) as data_request,
           (select count(*) from public.placement_payment) as placement_payment,
           (select count(*) from public.owner_totp) as owner_totp,
           (select count(*) from public.recovery_code) as recovery_code,
           (select count(*) from public.step_up) as step_up`);
  return Object.fromEntries(COUNTED.map((key) => [key, Number(row?.[key] ?? 0)]));
}

export async function cleanOut(sql: Sql, options: CleanOutOptions): Promise<CleanOutReport> {
  const email = options.keepEmail.trim().toLowerCase();
  if (email === "") throw new Error("keepEmail is required");

  await sql("begin");
  try {
    const keepers = await sql(
      `select a.id::text as id, a.role, u."emailVerified" as verified
         from public.app_user a join neon_auth."user" u on u.id::text = a.id
        where lower(u.email) = ${literal(email)}`,
    );
    const keeper = keepers[0];
    if (keepers.length !== 1 || !keeper) throw new Error(`Expected exactly one account with the email ${email}, found ${keepers.length}.`);
    const keptRole = String(keeper.role);
    if (keptRole !== "owner" && keptRole !== "admin") throw new Error(`The account to keep must be the owner (or an admin), not ${keptRole}.`);
    if (keeper.verified !== true) throw new Error("The account to keep must have a verified email.");
    const keep = literal(String(keeper.id));

    const before = await counts(sql);
    const deleted: Record<string, number> = {};
    const run = async (name: string, statement: string): Promise<void> => {
      const rows = await sql(`with d as (${statement} returning 1) select count(*)::int as n from d`);
      deleted[name] = Number(rows[0]?.n ?? 0);
    };

    // The lead's owner column was renamed by migration 0022: read which one this database has, so the script works before and after it.
    const owner = await sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'lead' and column_name in ('assigned_admin_id', 'assigned_manager_id')`);
    const assignedColumn = String(owner[0]?.column_name ?? "");
    if (owner.length !== 1 || (assignedColumn !== "assigned_admin_id" && assignedColumn !== "assigned_manager_id")) throw new Error("Cannot tell which lead owner column this database has.");

    // The people to remove, and the leads that go with them. Temporary tables live for this transaction only.
    await sql(`create temp table gone_users on commit drop as select id from public.app_user where id <> ${keep}`);
    await sql(`create temp table gone_leads on commit drop as
                 select id from public.lead
                  where user_id in (select id from gone_users)
                     or ${assignedColumn} in (select id from gone_users)
                     ${options.includeUnlinkedLeads ? "or user_id is null" : ""}`);

    // Children before parents (every foreign key is `no action`).
    await sql(`update public.event set lead_id = null, lead_ref = null where lead_id in (select id from gone_leads)`);
    await run("data_request", `delete from public.data_request where lead_id in (select id from gone_leads) or user_id in (select id from gone_users)`);
    await run("placement_payment", `delete from public.placement_payment where lead_id in (select id from gone_leads)`);
    if (options.includeAllPayments) await run("placement_payment_unlinked", `delete from public.placement_payment where lead_id is null`);
    await run("lead_duplicate_decision", `delete from public.lead_duplicate_decision where lead_a_id in (select id from gone_leads) or lead_b_id in (select id from gone_leads)`);
    await run("lead_programme_pref", `delete from public.lead_programme_pref where lead_id in (select id from gone_leads)`);
    await run("lead_note", `delete from public.lead_note where lead_id in (select id from gone_leads)`);
    await run("lead_activity", `delete from public.lead_activity where lead_id in (select id from gone_leads)`);
    await run("lead_claim", `delete from public.lead_claim where lead_id in (select id from gone_leads) or user_id in (select id from gone_users)`);
    await run("student_profile", `delete from public.student_profile where user_id in (select id from gone_users) or lead_id in (select id from gone_leads)`);
    await sql(`update public.lead set merged_into_id = null where merged_into_id in (select id from gone_leads)`);
    await run("lead", `delete from public.lead where id in (select id from gone_leads)`);
    // Anything still pointing at a person who goes (a lead kept for being unlinked but assigned to them) is handed back to nobody.
    await sql(`update public.lead set ${assignedColumn} = null where ${assignedColumn} in (select id from gone_users)`);
    await run("step_up", `delete from public.step_up where user_id in (select id from gone_users)`);
    await run("recovery_code", `delete from public.recovery_code where user_id in (select id from gone_users)`);
    await run("owner_totp", `delete from public.owner_totp where user_id in (select id from gone_users)`);
    await run("app_user", `delete from public.app_user where id in (select id from gone_users)`);
    // Neon Auth: sessions, accounts, memberships and invitations go with the user (ON DELETE CASCADE); sign-in verification tokens are by email.
    await sql(`create temp table gone_emails on commit drop as select lower(email) as email from neon_auth."user" where id::text in (select id from gone_users)`);
    const hasVerification = (await sql(`select to_regclass('neon_auth.verification') is not null as ok`))[0]?.ok === true;
    if (hasVerification) await run("neon_auth_verification", `delete from neon_auth.verification where lower(identifier) in (select email from gone_emails)`);
    await run("neon_auth_user", `delete from neon_auth."user" where id::text in (select id from gone_users)`);

    const after = await counts(sql);
    if (after.app_user !== 1 || (after.neon_auth_user ?? 0) < 1) throw new Error(`Safety check failed: ${after.app_user} app users would remain (expected exactly the one kept).`);
    const stillThere = await sql(`select 1 from public.app_user where id = ${keep}`);
    if (stillThere.length !== 1) throw new Error("Safety check failed: the account to keep is not there after the clean-out.");

    if (options.confirm) {
      await sql("commit");
    } else {
      await sql("rollback");
    }
    return { keptUserId: String(keeper.id), keptRole, committed: options.confirm, before, deleted, after };
  } catch (error) {
    await sql("rollback").catch(() => undefined);
    throw error;
  }
}
