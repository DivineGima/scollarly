-- S14.5 (PRD_3 F15 amended, architecture 22.4, ADR-053): a student sees no screen of the app until onboarding is finished, and the server
-- enforces it. This migration records when a student finished.
--
-- Additive only: one nullable column, one trigger, one new session function. Nothing is dropped or changed in meaning.
--  * `app_user.onboarding_done_at`: set when the student's `student_profile` row is first written (the onboarding function makes it, so
--    the one place that finishes onboarding is also the one place that records it, and no other function needs to change). Staff accounts
--    never need it: the server only asks it of a student-role account.
--  * Backfill: every student who already has a profile counts as done, at the time the profile was made.
--  * `app_resolve_session_v3`: the session query of `app_resolve_session_v2` plus `onboarding_done`. v2 stays for older callers.
-- A student who confirmed an account before this change but never finished onboarding will be sent to the questionnaire at next sign-in.

ALTER TABLE public.app_user ADD COLUMN IF NOT EXISTS onboarding_done_at timestamptz;
--> statement-breakpoint

UPDATE public.app_user a
   SET onboarding_done_at = p.created_at
  FROM public.student_profile p
 WHERE p.user_id = a.id AND a.onboarding_done_at IS NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_mark_onboarded() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.app_user SET onboarding_done_at = coalesce(onboarding_done_at, now()) WHERE id = NEW.user_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS student_profile_marks_onboarded ON public.student_profile;
--> statement-breakpoint
CREATE TRIGGER student_profile_marks_onboarded AFTER INSERT ON public.student_profile
  FOR EACH ROW EXECUTE FUNCTION public.app_mark_onboarded();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_resolve_session_v3(p_token text)
RETURNS TABLE (user_id text, session_id text, email text, email_verified boolean, role text, step_up_at timestamptz, account_confirmed boolean, onboarding_done boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.user_id, s.session_id, s.email, s.email_verified, s.role, s.step_up_at,
         coalesce(a.account_confirmed_at IS NOT NULL, false), coalesce(a.onboarding_done_at IS NOT NULL, false)
    FROM public.app_resolve_session(p_token) s
    LEFT JOIN public.app_user a ON a.id = s.user_id
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_resolve_session_v3(text), public.app_mark_onboarded() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_resolve_session_v3(text) TO app_runtime;
