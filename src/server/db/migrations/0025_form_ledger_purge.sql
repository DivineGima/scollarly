-- Migration 0025 (version 5, architecture 24.2, 24.6, 24.7; S17.2 and S17.3). Additive: new nullable columns, a new flag with a default, new functions
-- and triggers. The one thing it replaces is the update policy and guard of `placement_payment`, to let the admin approve a ledger entry (24.2).
-- No erasure function is rewritten: erasure is hooked by triggers, as migration 0021 did for the lead source.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S17.2: the step-2 form (FR-43). Every column is nullable: the form is filled at step 2, and a profile made at sign-up has none of it.
-- ---------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.student_profile
  ADD COLUMN date_of_birth date,
  ADD COLUMN gender text,
  ADD COLUMN nationality text,
  ADD COLUMN residence_state text,
  ADD COLUMN city text,
  ADD COLUMN address text,
  ADD COLUMN guardian_name text,
  ADD COLUMN guardian_phone text,
  ADD COLUMN mother_name text,
  ADD COLUMN mother_phone text,
  ADD COLUMN passport_number text,
  ADD COLUMN form_completed_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.student_profile
  ADD CONSTRAINT student_profile_dob_range CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1940-01-01'),
  ADD CONSTRAINT student_profile_gender_check CHECK (gender IS NULL OR gender IN ('female', 'male', 'other')),
  ADD CONSTRAINT student_profile_nationality_format CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT student_profile_guardian_phone_format CHECK (guardian_phone IS NULL OR guardian_phone ~ '^[+][1-9][0-9]{6,14}$'),
  ADD CONSTRAINT student_profile_mother_phone_format CHECK (mother_phone IS NULL OR mother_phone ~ '^[+][1-9][0-9]{6,14}$'),
  ADD CONSTRAINT student_profile_passport_format CHECK (passport_number IS NULL OR passport_number ~ '^[A-Za-z0-9]{5,20}$'),
  ADD CONSTRAINT student_profile_form_text_length CHECK (
    char_length(coalesce(residence_state, '')) <= 120 AND char_length(coalesce(city, '')) <= 120 AND char_length(coalesce(address, '')) <= 300
    AND char_length(coalesce(guardian_name, '')) <= 120 AND char_length(coalesce(mother_name, '')) <= 120);
--> statement-breakpoint

-- The Admin's passport switch on a university (FR-43). Off by default: most universities do not ask.
ALTER TABLE public.university ADD COLUMN passport_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Does the application's university ask for a passport? An application names its programmes, and each programme belongs to a university. Definer
-- rights: a student cannot read a draft programme, and the answer is one yes or no.
CREATE OR REPLACE FUNCTION public.app_lead_passport_required(p_lead_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lead_programme_pref pp
      JOIN public.programme g ON g.id = pp.programme_id
      JOIN public.university u ON u.id = g.university_id
     WHERE pp.lead_id = p_lead_id AND u.passport_required)
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_lead_passport_required(uuid) TO app_runtime;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S17.3: the ledger (24.2, R4). A Manager's entry is pending until the Admin approves it, and every total, report and figure that reads the
-- ledger counts approved entries only. Rows that exist today, and an Admin's own entries, are approved.
-- ---------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.placement_payment ADD COLUMN approved_by text, ADD COLUMN approved_at timestamptz;
--> statement-breakpoint
UPDATE public.placement_payment SET approved_at = entered_at WHERE approved_at IS NULL;
--> statement-breakpoint
ALTER TABLE public.placement_payment ADD CONSTRAINT placement_payment_approval_consistency CHECK (approved_by IS NULL OR approved_at IS NOT NULL);
--> statement-breakpoint
GRANT UPDATE (approved_by, approved_at) ON public.placement_payment TO app_runtime;
--> statement-breakpoint

-- A manager enters an entry pending; an admin's is approved by them as it is made.
DROP POLICY placement_payment_insert ON public.placement_payment;
--> statement-breakpoint
CREATE POLICY placement_payment_insert ON public.placement_payment FOR INSERT TO app_runtime
  WITH CHECK (
    public.app_is_staff() AND entered_by = public.app_current_user_id()
    AND ((public.app_is_manager() AND approved_at IS NULL AND approved_by IS NULL)
         OR (public.app_is_admin() AND approved_at IS NOT NULL AND approved_by = public.app_current_user_id()))
  );
--> statement-breakpoint
-- A void is recorded as the person who made it (0011); an approval is the admin's own.
DROP POLICY placement_payment_update ON public.placement_payment;
--> statement-breakpoint
CREATE POLICY placement_payment_update ON public.placement_payment FOR UPDATE TO app_runtime
  USING (public.app_is_staff())
  WITH CHECK (
    public.app_is_staff()
    AND (voided_by = public.app_current_user_id()
         OR (voided_by IS NULL AND public.app_is_admin() AND approved_by = public.app_current_user_id()))
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.placement_payment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (NEW.id, NEW.submission_token, NEW.university_id, NEW.amount_usd_cents, NEW.received_on, NEW.note, NEW.entered_by, NEW.entered_at)
     IS DISTINCT FROM
     (OLD.id, OLD.submission_token, OLD.university_id, OLD.amount_usd_cents, OLD.received_on, OLD.note, OLD.entered_by, OLD.entered_at) THEN
    RAISE EXCEPTION 'A payment cannot be edited. Void it and enter the correct one.' USING ERRCODE = '23514';
  END IF;
  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id AND NEW.lead_id IS NOT NULL THEN
    RAISE EXCEPTION 'A payment cannot be linked to another lead. Void it and enter the correct one.' USING ERRCODE = '23514';
  END IF;
  IF OLD.voided_at IS NOT NULL
     AND (NEW.voided_at, NEW.voided_by, NEW.void_reason) IS DISTINCT FROM (OLD.voided_at, OLD.voided_by, OLD.void_reason) THEN
    RAISE EXCEPTION 'A voided payment cannot be changed.' USING ERRCODE = '23514';
  END IF;
  IF (NEW.approved_at, NEW.approved_by) IS DISTINCT FROM (OLD.approved_at, OLD.approved_by) THEN
    IF OLD.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'An approved payment cannot be approved again or un-approved.' USING ERRCODE = '23514';
    END IF;
    IF OLD.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'A voided payment cannot be approved.' USING ERRCODE = '23514';
    END IF;
    IF current_user = 'app_runtime' AND NOT public.app_is_admin() THEN
      RAISE EXCEPTION 'Only the admin approves a payment.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S17.3: the daily purge (24.7, ADR-068). A student's files are deleted when they have no open application and the latest Arrived or Closed
-- is at least 90 days old. A file whose upload never finished (still `pending` a day later) goes too. The Worker deletes the object first and
-- then calls `app_mark_documents_purged`, which checks the rule again, so a row is never marked purged while it should not be.
-- ---------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_student_purgeable(p_student_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.lead l WHERE l.user_id = p_student_id AND l.status = 'open' AND l.anonymised_at IS NULL)
     AND coalesce((SELECT max(greatest(coalesce(l.arrived_at, '-infinity'::timestamptz), coalesce(l.closed_at, '-infinity'::timestamptz)))
                     FROM public.lead l WHERE l.user_id = p_student_id AND l.status IN ('arrived', 'closed')) <= now() - interval '90 days', false)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_document_purgeable(p_state text, p_created_at timestamptz, p_student_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN p_state = 'pending' THEN p_created_at < now() - interval '1 day' ELSE public.app_student_purgeable(p_student_id) END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_purge_candidates(p_limit integer) RETURNS TABLE (document_id uuid, storage_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.id, d.storage_key FROM public.student_document d
   WHERE d.storage_key IS NOT NULL AND public.app_document_purgeable(d.state, d.created_at, d.student_id)
   ORDER BY d.student_id, d.created_at, d.id
   LIMIT greatest(1, least(p_limit, 100))
$$;
--> statement-breakpoint
-- One call marks the whole batch (the free plan allows about 50 outbound requests per run, so the marks must not cost one each).
CREATE OR REPLACE FUNCTION public.app_mark_documents_purged(p_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_done integer;
BEGIN
  UPDATE public.student_document d SET state = 'purged', storage_key = NULL
   WHERE d.id = ANY (p_ids) AND d.storage_key IS NOT NULL AND public.app_document_purgeable(d.state, d.created_at, d.student_id);
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_student_purgeable(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_document_purgeable(text, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_purge_candidates(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_mark_documents_purged(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_purge_candidates(integer), public.app_mark_documents_purged(uuid[]) TO app_runtime;
--> statement-breakpoint

-- The daily job records itself under one more name.
CREATE OR REPLACE FUNCTION public.app_record_job(p_job text, p_ok boolean, p_detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_job NOT IN ('rollup', 'usage', 'purge') THEN
    RAISE EXCEPTION 'Unknown job.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), NULL, 'job.' || p_job, 'job', p_job, jsonb_build_object('ok', p_ok) || coalesce(p_detail, '{}'::jsonb));
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------------------
-- S17.3: erasure (FR-49). Both erasure functions already exist; these triggers make them take the files too.
--  - Erasing a lead clears the student's files, unless the student has ANOTHER open application (then the erasure is of an old file and the
--    current one must keep its documents).
--  - Erasing an account deletes the student's document rows (the row points at the account, which is going away).
-- `app_erasure_document_keys` tells the Worker which objects to delete BEFORE it calls the erasure, so a failed delete stops the erasure.
-- ---------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_erasure_clears_documents(p_student_id text, p_lead_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_student_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.lead l WHERE l.user_id = p_student_id AND l.id <> p_lead_id AND l.status = 'open' AND l.anonymised_at IS NULL)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_erasure_document_keys(p_lead_id uuid) RETURNS TABLE (storage_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Only staff can erase a lead.' USING ERRCODE = '42501';
  END IF;
  -- A manager learns the keys of their own students' files only (the admin, of any).
  IF NOT public.app_is_admin()
     AND NOT EXISTS (SELECT 1 FROM public.lead l WHERE l.id = p_lead_id AND l.assigned_manager_id = public.app_current_user_id()) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d.storage_key FROM public.student_document d
     WHERE d.storage_key IS NOT NULL
       AND d.student_id IN (SELECT l.user_id FROM public.lead l
                             WHERE (l.id = p_lead_id OR l.merged_into_id = p_lead_id) AND public.app_erasure_clears_documents(l.user_id, l.id));
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_erasure_clears_documents(text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_erasure_document_keys(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_erasure_document_keys(uuid) TO app_runtime;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_lead_clear_documents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL AND public.app_erasure_clears_documents(OLD.user_id, OLD.id) THEN
    UPDATE public.student_document SET state = 'purged', storage_key = NULL WHERE student_id = OLD.user_id AND storage_key IS NOT NULL;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER lead_clear_documents AFTER UPDATE OF anonymised_at ON public.lead
  FOR EACH ROW EXECUTE FUNCTION public.app_lead_clear_documents();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_user_delete_documents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.student_document WHERE student_id = OLD.id;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER app_user_delete_documents BEFORE DELETE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.app_user_delete_documents();
--> statement-breakpoint

-- A manager erases only the leads assigned to them. `app_erase_lead` (migration 0006) runs with the owner's rights, so row level security does not
-- reach it, and until now any staff member could erase any lead. The signed-in user and role are still known inside it, so this trigger asks
-- the question at the moment a lead becomes anonymised; the admin is not restricted, and nor is a student erasing their own account.
CREATE OR REPLACE FUNCTION public.app_lead_erase_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL
     AND public.app_is_manager() AND OLD.assigned_manager_id IS DISTINCT FROM public.app_current_user_id() THEN
    RAISE EXCEPTION 'A manager can erase only the leads assigned to them.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER lead_erase_scope BEFORE UPDATE OF anonymised_at ON public.lead
  FOR EACH ROW EXECUTE FUNCTION public.app_lead_erase_scope();
