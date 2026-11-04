-- Review of S14.1 to S14.4, finding 1 (PRD_3 F21, architecture 22.3). A student who signed up with email and password has an unverified
-- email (we have no email sender, so Neon Auth does not verify). The auth facade now trusts such a session for a student only
-- (`src/server/auth/trusted-session.ts`). This function links a lead made in the student's own session to their account at once (S8.2); it
-- required `emailVerified`, so for a password student it would have refused silently and the lead would never appear on their page.
--
-- The only change is that `u."emailVerified"` is no longer required. It is safe because the lead is linked only to the account that owns the
-- session token, only within 2 minutes of the lead being received, and only for a student. Nothing that grants a role or claims a lead by its
-- email address changes: the owner bootstrap (0002), the invite acceptance (0004) and the email match in the claim checks (0006) still require a
-- verified email inside their own SQL. Additive: one `CREATE OR REPLACE`; no table or column changes.
CREATE OR REPLACE FUNCTION public.app_link_new_lead(p_lead_id uuid, p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text;
BEGIN
  SELECT s."userId"::text INTO v_user
    FROM neon_auth.session s
    JOIN neon_auth."user" u ON u.id = s."userId"
    JOIN public.app_user a ON a.id = s."userId"::text
   WHERE s.token = p_token AND s."expiresAt" > now() AND coalesce(u.banned, false) = false AND a.role = 'student';
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.lead SET user_id = v_user, last_activity_at = now()
   WHERE id = p_lead_id AND user_id IS NULL AND anonymised_at IS NULL AND merged_into_id IS NULL
     AND received_at > now() - interval '2 minutes';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.lead_claim (id, user_id, lead_id, method, status, decided_at)
    VALUES (gen_random_uuid(), v_user, p_lead_id, 'auto', 'approved', now());
  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    VALUES (gen_random_uuid(), p_lead_id, 'claimed', NULL, jsonb_build_object('method', 'auto'));
  RETURN true;
END
$$;
