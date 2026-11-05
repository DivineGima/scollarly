-- S15.3 (PRD_4 F24, FR-34; architecture 23.2, 23.3, ADR-059): the application is an explicit act made from the profile. One call creates
-- the lead (through the existing `app_create_lead`, so the idempotency key, the reference candidates, the number limit and the programme
-- check are the ones every lead already has), makes it the caller's own, links it from the profile and writes an audit row, all in one
-- transaction. One account has at most one application, whatever device, tab or request sends it.
--
-- Additive only: one new function. Nothing is dropped or changed in meaning.
--
-- What the caller sends is only which programmes (at least three, checked by the endpoint). The applicant's name, number, country, results
-- and consent are read here from the caller's own profile, so an application can never disagree with the profile and a forged body cannot
-- change who applied. The caller is read from the row level security context, never from an argument.
--
-- Outcomes (out_outcome):
--   created              a new lead, made the caller's own and linked from the profile
--   existing             the same idempotency key came again for the same person: the same lead and reference, nothing written
--   already_applied      this account already has an application (a second device, a stale page, a typed address): nothing written,
--                        out_lead_ref is the existing reference
--   profile_required     no profile yet: the person has not finished onboarding
--   not_allowed          not a signed-in, confirmed student-role account, or the key belongs to someone else's lead
--   number_limited       five leads from this number in 24 hours (the same rule as every lead)
--   unknown_programme    a chosen programme does not exist
--   ref_exhausted        no free reference (the caller retries)
CREATE OR REPLACE FUNCTION public.app_apply_from_profile(
  p_id uuid,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_refs text[],
  p_client_ref text,
  p_locale text,
  p_client_created_at timestamptz,
  p_received_at timestamptz,
  p_sla_due_at timestamptz,
  p_sla_hours integer,
  p_programme_ids uuid[],
  p_number_limit integer
) RETURNS TABLE (out_outcome text, out_lead_id uuid, out_lead_ref text, out_stored_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
  v_role text;
  v_confirmed timestamptz;
  v_found record;
  v_profile record;
  v_own record;
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

  -- The profile row is locked for the rest of the transaction: two applications from two devices at the same moment queue here, and the
  -- second one finds the first one's lead.
  SELECT sp.* INTO v_profile FROM public.student_profile sp WHERE sp.user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'profile_required'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- One application per account: the lead the profile points at, or any live lead already linked to the account (an application made
  -- before version 4 and claimed by the student).
  SELECT l.id, l.ref INTO v_own FROM public.lead l
   WHERE l.id = v_profile.lead_id
      OR (l.user_id = v_user AND l.anonymised_at IS NULL AND l.merged_into_id IS NULL)
   ORDER BY l.received_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'already_applied'::text, v_own.id, v_own.ref, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_created FROM public.app_create_lead(
    p_id, p_idempotency_key, p_payload_hash, p_refs, p_client_ref, v_profile.applicant_name, v_profile.contact_whatsapp_e164,
    v_profile.applicant_country, NULL, 'full', v_profile.qualification_type, v_profile.results,
    jsonb_build_object(
      'page', 'apply', 'relationship', v_profile.relationship, 'contact_name', v_profile.contact_name,
      'course_fields', to_jsonb(v_profile.course_fields), 'level', v_profile.level, 'intake_year', v_profile.intake_year
    ),
    p_locale, v_profile.consent_notice_version, v_profile.consent_at, p_client_created_at,
    p_received_at, p_sla_due_at, p_sla_hours, p_programme_ids, p_number_limit
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
  UPDATE public.student_profile SET lead_id = p_id, updated_at = now() WHERE user_id = v_user;

  -- Ids and codes only, never a name or a number (ADR-007, no personal data in logs).
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'application.submitted', 'student_profile', v_user,
            jsonb_build_object('lead_id', p_id, 'relationship', v_profile.relationship));

  RETURN QUERY SELECT 'created'::text, v_created.out_lead_id, v_created.out_lead_ref, v_created.out_stored_hash;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_apply_from_profile(uuid, uuid, text, text[], text, text, timestamptz, timestamptz, timestamptz, integer, uuid[], integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_apply_from_profile(uuid, uuid, text, text[], text, text, timestamptz, timestamptz, timestamptz, integer, uuid[], integer) TO app_runtime;
--> statement-breakpoint

-- The guard on the older lead endpoint (architecture 23.3). `POST /api/v1/leads` stays for requests queued by an earlier version, but a student
-- who already has an application must not be able to make a second one there. The endpoint has only the session token, so this answers from the
-- token: true when the session belongs to a student account that owns a live lead. Same session checks as `app_link_new_lead` (0016). Read-only.
CREATE OR REPLACE FUNCTION public.app_token_has_application(p_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM neon_auth.session s
      JOIN neon_auth."user" u ON u.id = s."userId"
      JOIN public.app_user a ON a.id = s."userId"::text
      JOIN public.lead l ON l.user_id = s."userId"::text AND l.anonymised_at IS NULL AND l.merged_into_id IS NULL
     WHERE s.token = p_token AND s."expiresAt" > now() AND coalesce(u.banned, false) = false AND a.role = 'student'
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_token_has_application(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_token_has_application(text) TO app_runtime;
