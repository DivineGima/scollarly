-- F30 (owner decision 2026-11-04: repair it with what we have). Email and password is on in Neon Auth with verification off, and Neon's own sign-up
-- address cannot be closed from our side. The danger: a stranger registers a password account on an email that later belongs to staff (or the owner);
-- when that person signs in with Google, Neon may link the Google login to the stranger's account, and the stranger's password then opens a
-- verified staff session.
--
-- The lock, in the database where it cannot be bypassed: a session whose account holds a password login ("credential" account) is never resolved
-- for the admin or owner role. Staff and the owner sign in with Google only. A student is not affected. If staff ever ends up with a password login
-- on their account, they are locked out (the safe failure) until the owner has the credential account removed in the Neon console.
--
-- Additive: `app_resolve_session_v3` is replaced with the same columns; nothing is dropped.

CREATE OR REPLACE FUNCTION public.app_resolve_session_v3(p_token text)
RETURNS TABLE (user_id text, session_id text, email text, email_verified boolean, role text, step_up_at timestamptz, account_confirmed boolean, onboarding_done boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.user_id, s.session_id, s.email, s.email_verified, s.role, s.step_up_at,
         coalesce(a.account_confirmed_at IS NOT NULL, false), coalesce(a.onboarding_done_at IS NOT NULL, false)
    FROM public.app_resolve_session(p_token) s
    LEFT JOIN public.app_user a ON a.id = s.user_id
   WHERE s.role NOT IN ('admin', 'owner')
      OR NOT EXISTS (SELECT 1 FROM neon_auth.account c WHERE c."userId"::text = s.user_id AND c."providerId" = 'credential')
$$;
