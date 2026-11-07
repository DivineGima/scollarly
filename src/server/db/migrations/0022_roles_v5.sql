-- Version 5, S16.1 (architecture 24.2, ADR-063): the roles are renamed to match the documents and a manager sees only assigned students.
--   stored `admin` (the staff who work leads) becomes `manager`; stored `owner` becomes `admin`; at most two admins.
--   `lead.assigned_admin_id` becomes `assigned_manager_id` (a rename, no data changes).
--   The nine SQL functions that test a role are rewritten, and the lead policies and the policies of the tables that hang off a lead now
--   scope a manager to the leads assigned to them. The admin and the student keep what they could see before.
-- The one non-additive step of version 5 (the role check and the one-owner index are replaced). It is safe because the one-time clean-out of
-- tracker_5 flag F41 leaves a single account, the owner's, so no `admin` row exists to remap; the update order below also works with rows.
-- The owner signs in again after the deploy (flag F45): a session that still carries the old role name reads as a student.

-- 1. Out of the way: the trigger that refuses to change the owner's role, the old check and the one-owner index.
DROP TRIGGER IF EXISTS app_user_owner_is_permanent ON public.app_user;
--> statement-breakpoint
ALTER TABLE public.app_user DROP CONSTRAINT IF EXISTS app_user_role_check;
--> statement-breakpoint
DROP INDEX IF EXISTS public.app_user_single_owner;
--> statement-breakpoint

-- 2. The rename. Order matters: staff first, so no row is ever `admin` twice over.
UPDATE public.app_user SET role = 'manager' WHERE role = 'admin';
--> statement-breakpoint
UPDATE public.app_user SET role = 'admin' WHERE role = 'owner';
--> statement-breakpoint
ALTER TABLE public.app_user ADD CONSTRAINT app_user_role_check CHECK (role IN ('student', 'manager', 'admin'));
--> statement-breakpoint

-- 3. Staff fields on the user row (there is no staff profile table). The manager's own WhatsApp number is used by the signed-in WhatsApp buttons.
ALTER TABLE public.app_user ADD COLUMN whatsapp_number text;
--> statement-breakpoint
ALTER TABLE public.app_user ADD COLUMN away boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.app_user ADD COLUMN last_assigned_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.app_user ADD CONSTRAINT app_user_whatsapp_format CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^[+][1-9][0-9]{6,14}$');
--> statement-breakpoint
-- An invite says which role it creates: a manager (the default) or the second admin.
ALTER TABLE public.admin_invite ADD COLUMN role text NOT NULL DEFAULT 'manager';
--> statement-breakpoint
ALTER TABLE public.admin_invite ADD CONSTRAINT admin_invite_role_check CHECK (role IN ('manager', 'admin'));
--> statement-breakpoint

-- 4. The lead's owner column.
ALTER TABLE public.lead RENAME COLUMN assigned_admin_id TO assigned_manager_id;
--> statement-breakpoint
ALTER TABLE public.lead RENAME CONSTRAINT lead_assigned_admin_id_app_user_id_fk TO lead_assigned_manager_id_app_user_id_fk;
--> statement-breakpoint

-- 5. At most two admins. A trigger, so no code path can go round it; the advisory lock makes two promotions at the same moment queue.
CREATE OR REPLACE FUNCTION public.app_user_max_two_admins() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'admin' AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'admin') THEN
    PERFORM pg_advisory_xact_lock(hashtext('app_user_admin_cap'));
    IF (SELECT count(*) FROM public.app_user a WHERE a.role = 'admin' AND a.id <> NEW.id) >= 2 THEN
      RAISE EXCEPTION 'At most two admins are allowed.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS app_user_max_two_admins ON public.app_user;
--> statement-breakpoint
CREATE TRIGGER app_user_max_two_admins BEFORE INSERT OR UPDATE OF role ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.app_user_max_two_admins();
--> statement-breakpoint
-- An admin's role is permanent, as the owner's was (ADR-013): it cannot be changed back to manager or student by a stray update.
CREATE OR REPLACE FUNCTION public.app_user_admin_is_permanent() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'admin' AND NEW.role <> 'admin' THEN
    RAISE EXCEPTION 'The admin role cannot be removed.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER app_user_admin_is_permanent BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.app_user_admin_is_permanent();
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.app_user_owner_is_permanent();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_user_confirm_on_promotion() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.role IN ('manager', 'admin') AND NEW.account_confirmed_at IS NULL AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role) THEN
    NEW.account_confirmed_at := now();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- 6. The role functions the policies call. Policies hold the function by identity, so renaming keeps every policy working.
ALTER FUNCTION public.app_is_owner() RENAME TO app_is_admin;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT public.app_current_role() = 'admin' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_manager() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT public.app_current_role() = 'manager' $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_is_manager() TO app_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_staff() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT public.app_current_role() IN ('manager', 'admin') $$;
--> statement-breakpoint

-- The one policy that names the role in its text (migration 0002): only the admin changes roles.
DROP POLICY app_user_update ON public.app_user;
--> statement-breakpoint
CREATE POLICY app_user_update ON public.app_user FOR UPDATE TO app_runtime
  USING (public.app_current_role() = 'admin') WITH CHECK (public.app_current_role() = 'admin');
--> statement-breakpoint

-- 7. The owner bootstrap, now the admin bootstrap: the first verified account with the configured email becomes the admin, once.
DROP FUNCTION IF EXISTS public.app_bootstrap_owner(text, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_bootstrap_admin(p_user_id text, p_admin_email text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_admin_email IS NULL OR p_admin_email = '' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM neon_auth."user" u
     WHERE u.id::text = p_user_id AND lower(u.email) = lower(p_admin_email) AND u."emailVerified"
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.app_user a SET role = 'admin'
   WHERE a.id = p_user_id AND NOT EXISTS (SELECT 1 FROM public.app_user o WHERE o.role = 'admin');
  RETURN FOUND;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_bootstrap_admin(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_bootstrap_admin(text, text) TO app_runtime;
--> statement-breakpoint

-- 8. An accepted invite creates the role the invite names. A second admin is refused here with the same answer as a bad invite; the trigger
-- above is the lock behind it.
CREATE OR REPLACE FUNCTION public.app_accept_invite(p_session_token text, p_invite_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid text;
  v_email text;
  v_verified boolean;
  v_invite public.admin_invite%ROWTYPE;
  v_role text;
BEGIN
  SELECT u.id::text, u.email, u."emailVerified" INTO v_uid, v_email, v_verified
    FROM neon_auth.session s JOIN neon_auth."user" u ON u.id = s."userId"
   WHERE s.token = p_session_token AND s."expiresAt" > now() AND NOT coalesce(u.banned, false);
  IF v_uid IS NULL OR NOT coalesce(v_verified, false) THEN
    RETURN 'invalid';
  END IF;

  SELECT * INTO v_invite FROM public.admin_invite WHERE token_hash = p_invite_hash FOR UPDATE;
  IF NOT FOUND OR v_invite.accepted_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL OR v_invite.expires_at <= now() THEN
    RETURN 'invalid';
  END IF;
  IF lower(v_invite.email) <> lower(v_email) THEN
    RETURN 'wrong_email';
  END IF;

  INSERT INTO public.app_user (id) VALUES (v_uid) ON CONFLICT (id) DO NOTHING;
  SELECT a.role INTO v_role FROM public.app_user a WHERE a.id = v_uid FOR UPDATE;
  IF v_role = 'admin' THEN
    RETURN 'invalid';
  END IF;
  IF v_invite.role = 'admin' THEN
    PERFORM pg_advisory_xact_lock(hashtext('app_user_admin_cap'));
    IF (SELECT count(*) FROM public.app_user a WHERE a.role = 'admin') >= 2 THEN
      RETURN 'invalid';
    END IF;
  END IF;

  UPDATE public.app_user SET role = v_invite.role WHERE id = v_uid;
  UPDATE public.admin_invite SET accepted_at = now() WHERE id = v_invite.id;
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_uid, 'team.acceptInvite', 'admin_invite', v_invite.id::text, jsonb_build_object('role', v_invite.role));
  RETURN 'accepted';
END
$$;
--> statement-breakpoint

-- 9. The team list: managers and admins, the admins first.
CREATE OR REPLACE FUNCTION public.app_list_team()
RETURNS TABLE(user_id text, email text, name text, role text, leads_held bigint, since timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.id, u.email, u.name, a.role,
           (SELECT count(*) FROM public.lead l WHERE l.assigned_manager_id = a.id AND l.merged_into_id IS NULL),
           a.created_at
      FROM public.app_user a JOIN neon_auth."user" u ON u.id::text = a.id
     WHERE a.role IN ('manager', 'admin')
     ORDER BY (a.role = 'admin') DESC, u.email;
END
$$;
--> statement-breakpoint

-- 10. Removing a manager: only an admin can; the manager's students go back to the admin (no manager, so only an admin sees them) and the
-- manager's sessions end at once. (The student profile column that also holds a manager arrives in migration 0023, whose
-- `app_remove_manager` replaces this one.)
DROP FUNCTION IF EXISTS public.app_remove_admin(text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_remove_manager(p_user_id text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := public.app_current_user_id();
  v_released integer := 0;
BEGIN
  IF public.app_current_role() <> 'admin' OR v_actor IS NULL OR v_actor = '' THEN
    RAISE EXCEPTION 'Only an admin can remove a manager.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.app_user SET role = 'student' WHERE id = p_user_id AND role = 'manager';
  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  WITH moved AS (
    UPDATE public.lead SET assigned_manager_id = NULL, last_activity_at = now()
     WHERE assigned_manager_id = p_user_id
    RETURNING id
  )
  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    SELECT gen_random_uuid(), moved.id, 'assigned', v_actor,
           jsonb_build_object('from', p_user_id, 'to', NULL, 'reason', 'manager_removed')
      FROM moved;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  UPDATE neon_auth.session s SET "expiresAt" = now() WHERE s."userId"::text = p_user_id AND s."expiresAt" > now();

  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_actor, 'team.removeManager', 'app_user', p_user_id, jsonb_build_object('leads_released', v_released));
  RETURN v_released;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_remove_manager(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_remove_manager(text) TO app_runtime;
--> statement-breakpoint

-- 11. A staff session is for staff who signed in with Google, not with a password (migration 0018): the names are the new ones.
CREATE OR REPLACE FUNCTION public.app_resolve_session_v3(p_token text)
RETURNS TABLE (user_id text, session_id text, email text, email_verified boolean, role text, step_up_at timestamptz, account_confirmed boolean, onboarding_done boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.user_id, s.session_id, s.email, s.email_verified, s.role, s.step_up_at,
         coalesce(a.account_confirmed_at IS NOT NULL, false), coalesce(a.onboarding_done_at IS NOT NULL, false)
    FROM public.app_resolve_session(p_token) s
    LEFT JOIN public.app_user a ON a.id = s.user_id
   WHERE s.role NOT IN ('manager', 'admin')
      OR NOT EXISTS (SELECT 1 FROM neon_auth.account c WHERE c."userId"::text = s.user_id AND c."providerId" = 'credential')
$$;
--> statement-breakpoint

-- 12. Row level security (architecture 24.2, review finding A5). The lead is the root: the admin sees and changes every lead, a manager the
-- leads assigned to them, a student their own. Every table that hangs off a lead asks "may I see this lead?" through the one helper, which
-- reads `lead` under the same policy, so the rule is written once.
CREATE OR REPLACE FUNCTION public.app_can_see_lead(p_lead_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.lead l WHERE l.id = p_lead_id) $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_can_see_lead(uuid) TO app_runtime;
--> statement-breakpoint

DROP POLICY lead_read ON public.lead;
--> statement-breakpoint
CREATE POLICY lead_read ON public.lead FOR SELECT TO app_runtime
  USING (
    public.app_is_admin()
    OR (public.app_is_manager() AND assigned_manager_id = public.app_current_user_id())
    OR user_id = public.app_current_user_id()
  );
--> statement-breakpoint
DROP POLICY lead_update ON public.lead;
--> statement-breakpoint
CREATE POLICY lead_update ON public.lead FOR UPDATE TO app_runtime
  USING (public.app_is_admin() OR (public.app_is_manager() AND assigned_manager_id = public.app_current_user_id()))
  WITH CHECK (public.app_is_admin() OR (public.app_is_manager() AND assigned_manager_id = public.app_current_user_id()));
--> statement-breakpoint

DROP POLICY lead_programme_pref_read ON public.lead_programme_pref;
--> statement-breakpoint
CREATE POLICY lead_programme_pref_read ON public.lead_programme_pref FOR SELECT TO app_runtime
  USING (public.app_can_see_lead(lead_id));
--> statement-breakpoint

DROP POLICY lead_activity_read ON public.lead_activity;
--> statement-breakpoint
CREATE POLICY lead_activity_read ON public.lead_activity FOR SELECT TO app_runtime
  USING (public.app_is_staff() AND public.app_can_see_lead(lead_id));
--> statement-breakpoint
DROP POLICY lead_activity_insert ON public.lead_activity;
--> statement-breakpoint
CREATE POLICY lead_activity_insert ON public.lead_activity FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() AND actor_id = public.app_current_user_id() AND public.app_can_see_lead(lead_id));
--> statement-breakpoint

DROP POLICY lead_note_read ON public.lead_note;
--> statement-breakpoint
CREATE POLICY lead_note_read ON public.lead_note FOR SELECT TO app_runtime
  USING (public.app_is_staff() AND public.app_can_see_lead(lead_id));
--> statement-breakpoint
DROP POLICY lead_note_insert ON public.lead_note;
--> statement-breakpoint
CREATE POLICY lead_note_insert ON public.lead_note FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() AND author_id = public.app_current_user_id() AND public.app_can_see_lead(lead_id));
--> statement-breakpoint
DROP POLICY lead_note_update ON public.lead_note;
--> statement-breakpoint
CREATE POLICY lead_note_update ON public.lead_note FOR UPDATE TO app_runtime
  USING (public.app_is_staff() AND public.app_can_see_lead(lead_id))
  WITH CHECK (public.app_is_staff() AND public.app_can_see_lead(lead_id));
--> statement-breakpoint

DROP POLICY lead_claim_read ON public.lead_claim;
--> statement-breakpoint
CREATE POLICY lead_claim_read ON public.lead_claim FOR SELECT TO app_runtime
  USING ((public.app_is_staff() AND public.app_can_see_lead(lead_id)) OR user_id = public.app_current_user_id());
--> statement-breakpoint
DROP POLICY lead_claim_update ON public.lead_claim;
--> statement-breakpoint
CREATE POLICY lead_claim_update ON public.lead_claim FOR UPDATE TO app_runtime
  USING (public.app_is_staff() AND public.app_can_see_lead(lead_id))
  WITH CHECK (public.app_is_staff() AND public.app_can_see_lead(lead_id));
--> statement-breakpoint

DROP POLICY lead_duplicate_decision_read ON public.lead_duplicate_decision;
--> statement-breakpoint
CREATE POLICY lead_duplicate_decision_read ON public.lead_duplicate_decision FOR SELECT TO app_runtime
  USING (public.app_is_staff() AND public.app_can_see_lead(lead_a_id) AND public.app_can_see_lead(lead_b_id));
--> statement-breakpoint
DROP POLICY lead_duplicate_decision_insert ON public.lead_duplicate_decision;
--> statement-breakpoint
CREATE POLICY lead_duplicate_decision_insert ON public.lead_duplicate_decision FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() AND decided_by = public.app_current_user_id() AND public.app_can_see_lead(lead_a_id) AND public.app_can_see_lead(lead_b_id));
