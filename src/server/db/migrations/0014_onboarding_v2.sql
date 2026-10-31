-- S13.3 (architecture 21.6, ADR-043): finishing onboarding is ONE call. It creates the lead of kind `onboarding` through app_create_lead
-- (so the idempotency key, the reference candidates and the number limit are the ones every lead already has), links the lead to the
-- caller, and stores their profile and an audit row, all in the one transaction of the function. Additive: one new function.
--
-- Outcomes (out_outcome):
--   created              a new lead and a new profile
--   existing             the same idempotency key came again for the same person: the same lead and reference, nothing written
--   already_onboarded    this person has a profile from another request (a second device): nothing written, the app carries on
--   not_allowed          not a signed-in, confirmed student-role account, or the key belongs to someone else's lead
--   number_limited       five leads from this number in 24 hours (the same rule as every lead)
--   ref_exhausted        no free reference (the caller retries)
CREATE OR REPLACE FUNCTION public.app_complete_onboarding(
  p_id uuid,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_refs text[],
  p_client_ref text,
  p_name text,
  p_whatsapp text,
  p_country text,
  p_qualification text,
  p_results jsonb,
  p_source jsonb,
  p_locale text,
  p_consent_version text,
  p_consent_at timestamptz,
  p_client_created_at timestamptz,
  p_received_at timestamptz,
  p_sla_due_at timestamptz,
  p_sla_hours integer,
  p_number_limit integer,
  p_relationship text,
  p_contact_name text,
  p_level text,
  p_course_fields text[],
  p_intake_year smallint
) RETURNS TABLE (out_outcome text, out_lead_id uuid, out_lead_ref text, out_stored_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
  v_role text;
  v_confirmed timestamptz;
  v_found record;
  v_created record;
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  SELECT a.role, a.account_confirmed_at INTO v_role, v_confirmed FROM public.app_user a WHERE a.id = v_user;
  IF NOT FOUND OR v_role <> 'student' OR v_confirmed IS NULL THEN
    RETURN QUERY SELECT 'not_allowed'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- A replay of the request that already did this (an offline retry, a double tap) answers with the same lead.
  SELECT l.id, l.ref, l.payload_hash, l.user_id INTO v_found FROM public.lead l WHERE l.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_found.user_id = v_user THEN
      RETURN QUERY SELECT 'existing'::text, v_found.id, v_found.ref, v_found.payload_hash;
    ELSE
      RETURN QUERY SELECT 'not_allowed'::text, NULL::uuid, NULL::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  -- One onboarding per account. A second device with its own key lands here and is told to carry on; it never makes a second lead.
  IF EXISTS (SELECT 1 FROM public.student_profile sp WHERE sp.user_id = v_user) THEN
    RETURN QUERY SELECT 'already_onboarded'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_created FROM public.app_create_lead(
    p_id, p_idempotency_key, p_payload_hash, p_refs, p_client_ref, p_name, p_whatsapp, p_country, NULL, 'onboarding',
    p_qualification, p_results, p_source, p_locale, p_consent_version, p_consent_at, p_client_created_at,
    p_received_at, p_sla_due_at, p_sla_hours, '{}'::uuid[], p_number_limit
  );
  IF v_created.out_outcome <> 'created' THEN
    RETURN QUERY SELECT v_created.out_outcome, v_created.out_lead_id, v_created.out_lead_ref, v_created.out_stored_hash;
    RETURN;
  END IF;

  -- The lead is the caller's own from the first moment, like a lead made while signed in (migration 0009, app_link_new_lead).
  UPDATE public.lead SET user_id = v_user WHERE id = p_id;
  INSERT INTO public.lead_claim (id, user_id, lead_id, method, status, decided_at)
    VALUES (gen_random_uuid(), v_user, p_id, 'auto', 'approved', now());
  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    VALUES (gen_random_uuid(), p_id, 'claimed', NULL, jsonb_build_object('method', 'auto'));

  INSERT INTO public.student_profile (
    user_id, relationship, applicant_name, applicant_country, contact_name, contact_whatsapp_e164, qualification_type, results,
    level, course_fields, intake_year, consent_notice_version, consent_at, lead_id
  ) VALUES (
    v_user, p_relationship, p_name, p_country, p_contact_name, p_whatsapp, p_qualification, p_results,
    p_level, p_course_fields, p_intake_year, p_consent_version, p_consent_at, p_id
  );

  -- Ids and codes only, never a name or a number (ADR-007, no personal data in logs).
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'onboarding.completed', 'student_profile', v_user,
            jsonb_build_object('lead_id', p_id, 'relationship', p_relationship));

  RETURN QUERY SELECT 'created'::text, v_created.out_lead_id, v_created.out_lead_ref, v_created.out_stored_hash;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_complete_onboarding(uuid, uuid, text, text[], text, text, text, text, text, jsonb, jsonb, text, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer, text, text, text, text[], smallint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_complete_onboarding(uuid, uuid, text, text[], text, text, text, text, text, jsonb, jsonb, text, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer, text, text, text, text[], smallint) TO app_runtime;
