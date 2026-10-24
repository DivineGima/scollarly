-- Row level security as a second lock under the auth facade (ADR-038, D15).
--
-- * The Worker connects as `app_runtime`: not the table owner, no BYPASSRLS. (Neon's default owner role has BYPASSRLS,
--   so row level security would do nothing if the app connected as the owner.) CI sets the password after migrating.
-- * Every table has RLS enabled and FORCED, and at least one policy. A test fails if a table has none.
-- * Each request sets `app.user_id` and `app.role` inside the same transaction as its query (src/server/db/rls.ts).
--   Our own code sets them, so this protects against a missing check in application code; it is not a defence
--   against SQL injection.
-- * The one cross-schema read, Neon Auth's session and user, happens inside a SECURITY DEFINER function so the
--   runtime role needs no grant on the `neon_auth` schema.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_current_role() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_is_staff() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT public.app_current_role() IN ('admin', 'owner') $$;
--> statement-breakpoint

-- The one query the auth facade runs per request (ADR-034). Looks the Neon Auth session token up, creates our
-- `app_user` row on the first sign-in (idempotent) and returns the role and the step-up time with it.
CREATE OR REPLACE FUNCTION public.app_resolve_session(p_token text)
RETURNS TABLE (user_id text, session_id text, email text, email_verified boolean, role text, step_up_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid text;
  v_sid text;
  v_email text;
  v_verified boolean;
  v_role text;
BEGIN
  SELECT s.id::text, u.id::text, u.email, u."emailVerified"
    INTO v_sid, v_uid, v_email, v_verified
    FROM neon_auth.session s
    JOIN neon_auth."user" u ON u.id = s."userId"
   WHERE s.token = p_token
     AND s."expiresAt" > now()
     AND NOT coalesce(u.banned, false);
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT a.role INTO v_role FROM public.app_user a WHERE a.id = v_uid;
  IF v_role IS NULL THEN
    INSERT INTO public.app_user (id) VALUES (v_uid) ON CONFLICT (id) DO NOTHING;
    SELECT a.role INTO v_role FROM public.app_user a WHERE a.id = v_uid;
  END IF;

  RETURN QUERY
    SELECT v_uid, v_sid, v_email, v_verified, v_role,
           (SELECT st.verified_at FROM public.step_up st WHERE st.session_id = v_sid);
END
$$;
--> statement-breakpoint

-- Owner bootstrap (S2.3): the first verified sign-in with OWNER_EMAIL becomes the owner. Done in a SECURITY DEFINER
-- function because no policy lets the runtime role promote itself. The partial unique index also refuses a second owner.
CREATE OR REPLACE FUNCTION public.app_bootstrap_owner(p_user_id text, p_owner_email text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_owner_email IS NULL OR p_owner_email = '' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM neon_auth."user" u
     WHERE u.id::text = p_user_id AND lower(u.email) = lower(p_owner_email) AND u."emailVerified"
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.app_user a SET role = 'owner'
   WHERE a.id = p_user_id AND NOT EXISTS (SELECT 1 FROM public.app_user o WHERE o.role = 'owner');
  RETURN FOUND;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_bootstrap_owner(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_bootstrap_owner(text, text) TO app_runtime;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_resolve_session(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_resolve_session(text) TO app_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_current_user_id(), public.app_current_role(), public.app_is_staff() TO app_runtime;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint

-- app_user: a user reads their own row, staff read all, only the owner changes roles. Rows are created by app_resolve_session.
ALTER TABLE public.app_user ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.app_user FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.app_user TO app_runtime;
--> statement-breakpoint
CREATE POLICY app_user_select ON public.app_user FOR SELECT TO app_runtime
  USING (id = public.app_current_user_id() OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY app_user_update ON public.app_user FOR UPDATE TO app_runtime
  USING (public.app_current_role() = 'owner') WITH CHECK (public.app_current_role() = 'owner');
--> statement-breakpoint

-- owner_totp, recovery_code, step_up: only the user they belong to.
ALTER TABLE public.owner_totp ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.owner_totp FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.owner_totp TO app_runtime;
--> statement-breakpoint
CREATE POLICY owner_totp_own ON public.owner_totp FOR ALL TO app_runtime
  USING (user_id = public.app_current_user_id()) WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint

ALTER TABLE public.recovery_code ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.recovery_code FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.recovery_code TO app_runtime;
--> statement-breakpoint
CREATE POLICY recovery_code_own ON public.recovery_code FOR ALL TO app_runtime
  USING (user_id = public.app_current_user_id()) WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint

ALTER TABLE public.step_up ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.step_up FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.step_up TO app_runtime;
--> statement-breakpoint
CREATE POLICY step_up_own ON public.step_up FOR ALL TO app_runtime
  USING (user_id = public.app_current_user_id()) WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint

-- media_asset: image metadata is public content; only staff change it.
ALTER TABLE public.media_asset ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.media_asset FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.media_asset TO app_runtime;
--> statement-breakpoint
CREATE POLICY media_asset_read ON public.media_asset FOR SELECT TO app_runtime USING (true);
--> statement-breakpoint
CREATE POLICY media_asset_write ON public.media_asset FOR INSERT TO app_runtime WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY media_asset_update ON public.media_asset FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint

-- phase0_lead_stub: staff read leads. Anonymous submission goes through app_create_phase0_lead (below), so the runtime role
-- needs no INSERT grant and no policy that lets a visitor read anything back.
ALTER TABLE public.phase0_lead_stub ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.phase0_lead_stub FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON public.phase0_lead_stub TO app_runtime;
--> statement-breakpoint
CREATE POLICY phase0_lead_read ON public.phase0_lead_stub FOR SELECT TO app_runtime USING (public.app_is_staff());
--> statement-breakpoint

-- Idempotent anonymous lead creation in one call: insert, or return the existing row for the same key. The caller compares
-- the stored hash to tell a safe retry (same payload) from a reused key (different payload).
CREATE OR REPLACE FUNCTION public.app_create_phase0_lead(
  p_id uuid, p_key uuid, p_hash text, p_name text, p_whatsapp text, p_country text
) RETURNS TABLE (lead_id uuid, stored_hash text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.phase0_lead_stub (id, idempotency_key, payload_hash, name, whatsapp_e164, country_code)
  VALUES (p_id, p_key, p_hash, p_name, p_whatsapp, p_country)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, p_hash, true;
    RETURN;
  END IF;
  RETURN QUERY SELECT l.id, l.payload_hash, false FROM public.phase0_lead_stub l WHERE l.idempotency_key = p_key;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_create_phase0_lead(uuid, uuid, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_create_phase0_lead(uuid, uuid, text, text, text, text) TO app_runtime;
--> statement-breakpoint

-- phase0_content: public to read, staff to write.
ALTER TABLE public.phase0_content ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.phase0_content FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.phase0_content TO app_runtime;
--> statement-breakpoint
CREATE POLICY phase0_content_read ON public.phase0_content FOR SELECT TO app_runtime USING (true);
--> statement-breakpoint
CREATE POLICY phase0_content_write ON public.phase0_content FOR INSERT TO app_runtime WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY phase0_content_update ON public.phase0_content FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
