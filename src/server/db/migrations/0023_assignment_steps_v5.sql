-- Version 5, S16.2 and S16.3 (architecture 24.2 to 24.4, ADR-064, ADR-065, ADR-071).
--   S16.2: a student gets a manager when onboarding finishes (the profile is made then, so the profile holds the manager and the lead copies it
--          at apply); an admin can move a student; a manager can be away; a person can set their own WhatsApp number.
--   S16.3: the seven steps are the seven rows of `pipeline_stage`; a lead gets a status, the times the rules need, and at most one lead per
--          account can be open.
-- Additive except for the three retired `pipeline_stage` rows (reference data, replaced by their new meaning after every lead and template
-- that used them is moved), as the architecture says. Run after the one-time clean-out of tracker_5 flag F41.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S16.2
-- ---------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.student_profile ADD COLUMN assigned_manager_id text REFERENCES public.app_user(id);
--> statement-breakpoint
CREATE INDEX student_profile_assigned_manager_idx ON public.student_profile (assigned_manager_id);
--> statement-breakpoint
-- The admin sees every profile, a manager the profiles of their students, a student their own.
DROP POLICY student_profile_select ON public.student_profile;
--> statement-breakpoint
CREATE POLICY student_profile_select ON public.student_profile FOR SELECT TO app_runtime
  USING (
    user_id = public.app_current_user_id()
    OR public.app_is_admin()
    OR (public.app_is_manager() AND assigned_manager_id = public.app_current_user_id())
  );
--> statement-breakpoint

-- The next manager in turn: not away, the longest since the last student, ties broken by the date they joined. The advisory lock makes two
-- sign-ups at the same moment take turns instead of both getting the same manager. Returns null when nobody is available (the admin's
-- Unassigned list shows the student). Called only by `app_complete_profile`, so it is not granted to the runtime role.
CREATE OR REPLACE FUNCTION public.app_assign_manager() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('app_assign_manager'));
  SELECT a.id INTO v_id FROM public.app_user a
   WHERE a.role = 'manager' AND NOT a.away
   ORDER BY a.last_assigned_at NULLS FIRST, a.created_at, a.id
   LIMIT 1;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.app_user SET last_assigned_at = now() WHERE id = v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_assign_manager() FROM PUBLIC;
--> statement-breakpoint

-- Onboarding finishes: the profile is made (as before) and the student is given a manager in the same transaction.
CREATE OR REPLACE FUNCTION public.app_complete_profile(
  p_name text, p_whatsapp text, p_country text, p_qualification text, p_results jsonb, p_consent_version text,
  p_consent_at timestamp with time zone, p_relationship text, p_contact_name text, p_level text, p_course_fields text[], p_intake_year smallint
) RETURNS TABLE(out_outcome text)
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

  -- One profile per account. The primary key is the replay guard, so a retry, a double tap or a second device lands here and writes nothing
  -- (and takes no turn from the managers).
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

  UPDATE public.student_profile SET assigned_manager_id = public.app_assign_manager() WHERE user_id = v_user;

  -- Codes only, never a name or a number (ADR-007, no personal data in logs).
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'onboarding.completed', 'student_profile', v_user,
            jsonb_build_object('relationship', p_relationship));

  RETURN QUERY SELECT 'created'::text;
END
$$;
--> statement-breakpoint

-- The admin moves a student (and the student's open application) to another manager, or back to nobody. Admin only; audited with ids only.
CREATE OR REPLACE FUNCTION public.app_reassign_manager(p_student_id text, p_manager_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := public.app_current_user_id();
  v_from text;
BEGIN
  IF public.app_current_role() <> 'admin' OR v_actor IS NULL OR v_actor = '' THEN
    RAISE EXCEPTION 'Only an admin can move a student.' USING ERRCODE = '42501';
  END IF;
  IF p_manager_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.app_user a WHERE a.id = p_manager_id AND a.role = 'manager') THEN
    RETURN 'not_a_manager';
  END IF;

  SELECT sp.assigned_manager_id INTO v_from FROM public.student_profile sp WHERE sp.user_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_student';
  END IF;
  IF v_from IS NOT DISTINCT FROM p_manager_id THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public.student_profile SET assigned_manager_id = p_manager_id, updated_at = now() WHERE user_id = p_student_id;

  WITH moved AS (
    UPDATE public.lead SET assigned_manager_id = p_manager_id, last_activity_at = now()
     WHERE user_id = p_student_id AND status = 'open' AND anonymised_at IS NULL AND merged_into_id IS NULL
    RETURNING id
  )
  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    SELECT gen_random_uuid(), moved.id, 'assigned', v_actor, jsonb_build_object('from', v_from, 'to', p_manager_id, 'reason', 'reassigned')
      FROM moved;

  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_actor, 'student.reassign', 'student_profile', p_student_id,
            jsonb_build_object('from', v_from, 'to', p_manager_id));
  RETURN 'moved';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_reassign_manager(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_reassign_manager(text, text) TO app_runtime;
--> statement-breakpoint

-- A manager or admin sets their own away switch and WhatsApp number. Nobody can set another person's.
CREATE OR REPLACE FUNCTION public.app_set_staff_settings(p_away boolean, p_whatsapp text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
BEGIN
  IF v_user IS NULL OR v_user = '' OR public.app_current_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'Staff only.' USING ERRCODE = '42501';
  END IF;
  IF p_whatsapp IS NOT NULL AND p_whatsapp !~ '^[+][1-9][0-9]{6,14}$' THEN
    RETURN false;
  END IF;
  UPDATE public.app_user SET away = coalesce(p_away, away), whatsapp_number = p_whatsapp WHERE id = v_user;
  RETURN FOUND;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_set_staff_settings(boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_set_staff_settings(boolean, text) TO app_runtime;
--> statement-breakpoint

-- The WhatsApp number of the signed-in student's own manager, and nothing else about the manager: a student cannot read another person's row,
-- so this one definer function answers for the caller only. Null when the student has no manager or the manager has not set a number.
CREATE OR REPLACE FUNCTION public.app_my_manager_whatsapp() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.whatsapp_number FROM public.student_profile sp JOIN public.app_user a ON a.id = sp.assigned_manager_id
   WHERE sp.user_id = public.app_current_user_id() AND a.role = 'manager'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_my_manager_whatsapp() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_my_manager_whatsapp() TO app_runtime;
--> statement-breakpoint

-- Removing a manager also gives the manager's students (profiles and open leads) back to the admin. Replaces the 0022 version.
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

  UPDATE public.student_profile SET assigned_manager_id = NULL, updated_at = now() WHERE assigned_manager_id = p_user_id;

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

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S16.3
-- ---------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.lead ADD COLUMN status text NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE public.lead ADD CONSTRAINT lead_status_check CHECK (status IN ('open', 'arrived', 'closed'));
--> statement-breakpoint
ALTER TABLE public.lead ADD COLUMN closed_reason text;
--> statement-breakpoint
ALTER TABLE public.lead ADD COLUMN closed_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.lead ADD COLUMN arrived_at timestamp with time zone;
--> statement-breakpoint
-- The three-day clock of step 3: set when the file goes to the university.
ALTER TABLE public.lead ADD COLUMN university_submitted_at timestamp with time zone;
--> statement-breakpoint
-- The last time the student did something (quiet and suggest-closing are computed from it). Existing leads start at the day they arrived.
ALTER TABLE public.lead ADD COLUMN last_student_activity_at timestamp with time zone;
--> statement-breakpoint
UPDATE public.lead SET last_student_activity_at = received_at WHERE last_student_activity_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.lead ALTER COLUMN last_student_activity_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lead ALTER COLUMN last_student_activity_at SET DEFAULT now();
--> statement-breakpoint
-- One open application per account (architecture 24.2): a refused or abandoned application is closed and a new one opened.
CREATE UNIQUE INDEX lead_one_open_per_user ON public.lead (user_id)
  WHERE status = 'open' AND user_id IS NOT NULL AND anonymised_at IS NULL AND merged_into_id IS NULL;
--> statement-breakpoint
CREATE INDEX lead_manager_open_idx ON public.lead (assigned_manager_id, stage_code) WHERE status = 'open';
--> statement-breakpoint

-- Closing and reopening a file are written to the file's history (architecture 24.4): two new activity types.
ALTER TABLE public.lead_activity DROP CONSTRAINT lead_activity_type_check;
--> statement-breakpoint
ALTER TABLE public.lead_activity ADD CONSTRAINT lead_activity_type_check CHECK (type IN ('created', 'note', 'stage_changed', 'reply_logged', 'assigned', 'admin_wa_opened', 'claimed', 'merged', 'duplicate_dismissed', 'anonymised', 'closed', 'reopened'));
--> statement-breakpoint

-- The seven steps. Every lead keeps its place in the order: the first old stage becomes the first step, the second the second, and so on
-- (share_results -> course_interest, choose_course -> documents, confirm_admission -> registration; the other three keep their code).
-- New rows first (positions out of the way), then everything that pointed at a retired row is moved, then the retired rows go.
INSERT INTO public.pipeline_stage (code, position, name) VALUES
  ('course_interest', 101, '{"en": "Course interest", "fr": "Choix du cours"}'::jsonb),
  ('documents', 102, '{"en": "Documents", "fr": "Documents"}'::jsonb),
  ('university_review', 103, '{"en": "University review", "fr": "Étude par l''université"}'::jsonb),
  ('registration', 104, '{"en": "Registration", "fr": "Inscription"}'::jsonb)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
UPDATE public.lead SET stage_code = 'course_interest' WHERE stage_code = 'share_results';
--> statement-breakpoint
UPDATE public.lead SET stage_code = 'documents' WHERE stage_code = 'choose_course';
--> statement-breakpoint
UPDATE public.lead SET stage_code = 'registration' WHERE stage_code = 'confirm_admission';
--> statement-breakpoint
UPDATE public.message_template SET stage_code = 'course_interest' WHERE stage_code = 'share_results';
--> statement-breakpoint
UPDATE public.message_template SET stage_code = 'documents' WHERE stage_code = 'choose_course';
--> statement-breakpoint
UPDATE public.message_template SET stage_code = 'registration' WHERE stage_code = 'confirm_admission';
--> statement-breakpoint
DELETE FROM public.pipeline_stage WHERE code IN ('share_results', 'choose_course', 'confirm_admission');
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = position + 1000;
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = 1 WHERE code = 'course_interest';
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = 2 WHERE code = 'documents';
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = 3 WHERE code = 'university_review';
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = 4, name = '{"en": "Offer letter", "fr": "Lettre d''admission"}'::jsonb WHERE code = 'offer_letter';
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = 5 WHERE code = 'registration';
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = 6, name = '{"en": "Visa and travel", "fr": "Visa et voyage"}'::jsonb WHERE code = 'visa';
--> statement-breakpoint
UPDATE public.pipeline_stage SET position = 7, name = '{"en": "Arrival", "fr": "Arrivée"}'::jsonb WHERE code = 'arrived';
--> statement-breakpoint
ALTER TABLE public.lead ALTER COLUMN stage_code SET DEFAULT 'course_interest';
--> statement-breakpoint

-- Applying from the profile: the lead takes the profile's manager, and the rule is now "one OPEN application" (a closed one does not block a
-- new one). Everything else is as in migration 0020.
CREATE OR REPLACE FUNCTION public.app_apply_from_profile(
  p_id uuid, p_idempotency_key uuid, p_payload_hash text, p_refs text[], p_client_ref text, p_locale text,
  p_client_created_at timestamp with time zone, p_received_at timestamp with time zone, p_sla_due_at timestamp with time zone,
  p_sla_hours integer, p_programme_ids uuid[], p_number_limit integer
) RETURNS TABLE(out_outcome text, out_lead_id uuid, out_lead_ref text, out_stored_hash text)
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
  -- second one finds the first one's lead. (The partial unique index `lead_one_open_per_user` is the lock behind this check.)
  SELECT sp.* INTO v_profile FROM public.student_profile sp WHERE sp.user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'profile_required'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- One OPEN application per account: the open lead the profile points at, or any open live lead already linked to the account (an
  -- application made before version 4 and claimed by the student). A closed or arrived lead does not count.
  SELECT l.id, l.ref INTO v_own FROM public.lead l
   WHERE l.status = 'open' AND l.anonymised_at IS NULL AND l.merged_into_id IS NULL
     AND (l.id = v_profile.lead_id OR l.user_id = v_user)
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

  -- The lead is the caller's own from the first moment, like a lead made while signed in (migration 0009, app_link_new_lead), and it takes
  -- the manager the student was given when onboarding finished.
  UPDATE public.lead SET user_id = v_user, assigned_manager_id = v_profile.assigned_manager_id WHERE id = p_id;
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
