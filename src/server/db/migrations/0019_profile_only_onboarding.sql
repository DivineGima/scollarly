-- S15.2 (PRD_4 F24, FR-33; architecture 23.2, ADR-062): finishing onboarding stores the profile and nothing else. No lead is made; the
-- application is a separate, explicit act (`app_apply_from_profile`, S15.3).
--
-- Additive only: one new function. `app_complete_onboarding` (migration 0014) is NOT changed or dropped: an older tab or a request queued
-- by an earlier version is answered by the endpoint, which now calls this function. `student_profile.lead_id` is already nullable, and the
-- trigger of migration 0017 already records `app_user.onboarding_done_at` on the first insert, so a profile without a lead counts as done.
-- Staff already read every profile (`student_profile_select`, migration 0013), so no policy changes here.
--
-- Outcomes (out_outcome):
--   created              a new profile
--   already_onboarded    this person has a profile from another request or device: nothing written, the app carries on
--   not_allowed          not a signed-in, confirmed student-role account
CREATE OR REPLACE FUNCTION public.app_complete_profile(
  p_name text,
  p_whatsapp text,
  p_country text,
  p_qualification text,
  p_results jsonb,
  p_consent_version text,
  p_consent_at timestamptz,
  p_relationship text,
  p_contact_name text,
  p_level text,
  p_course_fields text[],
  p_intake_year smallint
) RETURNS TABLE (out_outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
  v_role text;
  v_confirmed timestamptz;
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  SELECT a.role, a.account_confirmed_at INTO v_role, v_confirmed FROM public.app_user a WHERE a.id = v_user;
  IF NOT FOUND OR v_role <> 'student' OR v_confirmed IS NULL THEN
    RETURN QUERY SELECT 'not_allowed'::text;
    RETURN;
  END IF;

  -- One profile per account. The primary key is the replay guard, so a retry, a double tap or a second device lands here and writes nothing.
  INSERT INTO public.student_profile (
    user_id, relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, qualification_type, results,
    level, course_fields, intake_year, consent_notice_version, consent_at, lead_id
  ) VALUES (
    v_user, p_relationship, p_name, p_country, p_contact_name, p_whatsapp, p_qualification, p_results,
    p_level, p_course_fields, p_intake_year, p_consent_version, p_consent_at, NULL
  ) ON CONFLICT (user_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'already_onboarded'::text;
    RETURN;
  END IF;

  -- Codes only, never a name or a number (ADR-007, no personal data in logs).
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'onboarding.completed', 'student_profile', v_user,
            jsonb_build_object('relationship', p_relationship));

  RETURN QUERY SELECT 'created'::text;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_complete_profile(text, text, text, text, jsonb, text, timestamptz, text, text, text, text[], smallint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_complete_profile(text, text, text, text, jsonb, text, timestamptz, text, text, text, text[], smallint) TO app_runtime;
