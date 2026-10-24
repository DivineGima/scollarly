CREATE UNIQUE INDEX "admin_invite_one_open_per_email" ON "admin_invite" USING btree (lower("email")) WHERE "admin_invite"."accepted_at" is null and "admin_invite"."revoked_at" is null;
--> statement-breakpoint
-- Stage 2 (S2.2 to S2.5). Everything below is additive: new functions, one trigger on our own table, one guarded trigger on
-- Neon's session table. The runtime role cannot read `neon_auth` tables, so each function that needs one is SECURITY DEFINER
-- with an empty search path, owned by the migration role, and callable only by `app_runtime`.

-- The owner is permanent (ADR-013, architecture 9.3): no update may take the owner role away. The partial unique index
-- already stops a second owner; this stops the first being demoted, by code, by a policy slip or by a typo.
CREATE OR REPLACE FUNCTION public.app_user_owner_is_permanent() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    RAISE EXCEPTION 'The owner role cannot be removed.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS app_user_owner_is_permanent ON public.app_user;
--> statement-breakpoint
CREATE TRIGGER app_user_owner_is_permanent BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.app_user_owner_is_permanent();
--> statement-breakpoint

-- F13: Neon Auth stores the visitor's IP address and browser string in neon_auth.session. CLAUDE.md says never store raw IP
-- addresses, and the table is Neon's, so (1) a trigger blanks both columns as each row is written, and (2) the sign-in
-- landing step and the daily cron call app_scrub_session_pii, in case Neon replaces the trigger in an update.
CREATE OR REPLACE FUNCTION public.app_blank_session_pii() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW."ipAddress" := NULL;
  NEW."userAgent" := NULL;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE OR REPLACE TRIGGER app_blank_session_pii BEFORE INSERT OR UPDATE ON neon_auth.session
    FOR EACH ROW EXECUTE FUNCTION public.app_blank_session_pii();
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'F13: could not create the trigger on neon_auth.session; app_scrub_session_pii still clears the columns.';
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_scrub_session_pii(p_token text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE neon_auth.session s SET "ipAddress" = NULL, "userAgent" = NULL
   WHERE (p_token IS NULL OR s.token = p_token) AND (s."ipAddress" IS NOT NULL OR s."userAgent" IS NOT NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint

-- B0: what an invite link says, for a visitor who is not signed in. The token is 32 random bytes and only its hash is stored.
CREATE OR REPLACE FUNCTION public.app_invite_status(p_invite_hash text)
RETURNS TABLE (email text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT i.email,
         CASE WHEN i.accepted_at IS NOT NULL THEN 'used'
              WHEN i.revoked_at IS NOT NULL THEN 'revoked'
              WHEN i.expires_at <= now() THEN 'expired'
              ELSE 'open' END
    FROM public.admin_invite i
   WHERE i.token_hash = p_invite_hash
$$;
--> statement-breakpoint

-- B0 step 2 (architecture 9.4): the role becomes admin only if Google's verified email equals the invited email, the invite is
-- open, and the signed-in user is not the owner. One transaction; the row lock makes a second use of the same link fail.
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
  IF v_role = 'owner' THEN
    RETURN 'invalid';
  END IF;

  UPDATE public.app_user SET role = 'admin' WHERE id = v_uid;
  UPDATE public.admin_invite SET accepted_at = now() WHERE id = v_invite.id;
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_uid, 'team.acceptInvite', 'admin_invite', v_invite.id::text, '{}'::jsonb);
  RETURN 'accepted';
END
$$;
--> statement-breakpoint

-- C2 step 6 (architecture 9.4): remove an admin. Role to student, sessions ended, their leads back to the unassigned pool with
-- an activity entry each, and an audit row, all in one transaction. Returns how many leads were released, or -1 when the user
-- is not an admin. Only the owner may call it (the row level security context is set by the caller in the same transaction).
-- Sessions are ended by setting their expiry, not by deleting Neon's rows (no physical deletes).
CREATE OR REPLACE FUNCTION public.app_remove_admin(p_user_id text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := public.app_current_user_id();
  v_released integer := 0;
BEGIN
  IF public.app_current_role() <> 'owner' OR v_actor IS NULL OR v_actor = '' THEN
    RAISE EXCEPTION 'Only the owner can remove an admin.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.app_user SET role = 'student' WHERE id = p_user_id AND role = 'admin';
  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  WITH moved AS (
    UPDATE public.lead SET assigned_admin_id = NULL, last_activity_at = now()
     WHERE assigned_admin_id = p_user_id
    RETURNING id
  )
  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    SELECT gen_random_uuid(), moved.id, 'assigned', v_actor,
           jsonb_build_object('from', p_user_id, 'to', NULL, 'reason', 'admin_removed')
      FROM moved;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  UPDATE neon_auth.session s SET "expiresAt" = now() WHERE s."userId"::text = p_user_id AND s."expiresAt" > now();

  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_actor, 'team.removeAdmin', 'app_user', p_user_id, jsonb_build_object('leads_released', v_released));
  RETURN v_released;
END
$$;
--> statement-breakpoint

-- C2 step 1: the staff list needs names and emails, which live in Neon Auth's tables. Staff only; the Team page is owner only.
CREATE OR REPLACE FUNCTION public.app_list_team()
RETURNS TABLE (user_id text, email text, name text, role text, leads_held bigint, since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.id, u.email, u.name, a.role,
           (SELECT count(*) FROM public.lead l WHERE l.assigned_admin_id = a.id AND l.merged_into_id IS NULL),
           a.created_at
      FROM public.app_user a JOIN neon_auth."user" u ON u.id::text = a.id
     WHERE a.role IN ('admin', 'owner')
     ORDER BY a.role DESC, u.email;
END
$$;
--> statement-breakpoint

-- B11 and C6: the signed-in user's own name and sessions. Identified by the session token, never by a caller-chosen user id.
CREATE OR REPLACE FUNCTION public.app_profile(p_token text) RETURNS TABLE (name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.name, u.email
    FROM neon_auth.session s JOIN neon_auth."user" u ON u.id = s."userId"
   WHERE s.token = p_token AND s."expiresAt" > now()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_my_sessions(p_token text)
RETURNS TABLE (created_at timestamptz, expires_at timestamptz, is_current boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT o."createdAt", o."expiresAt", (o.token = p_token)
    FROM neon_auth.session me JOIN neon_auth.session o ON o."userId" = me."userId"
   WHERE me.token = p_token AND me."expiresAt" > now() AND o."expiresAt" > now()
   ORDER BY o."createdAt" DESC
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_revoke_other_sessions(p_token text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE neon_auth.session o SET "expiresAt" = now()
   WHERE o."expiresAt" > now() AND o.token <> p_token
     AND o."userId" = (SELECT me."userId" FROM neon_auth.session me WHERE me.token = p_token AND me."expiresAt" > now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint

-- B11: "Edit name". Only the display name, only for the user the session token belongs to.
CREATE OR REPLACE FUNCTION public.app_set_profile_name(p_token text, p_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' OR char_length(p_name) > 80 THEN
    RETURN false;
  END IF;
  UPDATE neon_auth."user" u SET name = btrim(p_name), "updatedAt" = now()
   WHERE u.id = (SELECT s."userId" FROM neon_auth.session s WHERE s.token = p_token AND s."expiresAt" > now());
  RETURN FOUND;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_set_profile_name(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_scrub_session_pii(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_invite_status(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_accept_invite(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_remove_admin(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_list_team() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_profile(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_my_sessions(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_revoke_other_sessions(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  public.app_scrub_session_pii(text), public.app_invite_status(text), public.app_accept_invite(text, text),
  public.app_remove_admin(text), public.app_list_team(), public.app_profile(text), public.app_my_sessions(text),
  public.app_revoke_other_sessions(text), public.app_set_profile_name(text, text)
  TO app_runtime;
