-- Migration 0024 (version 5, architecture 24.2 and 24.5, S17.1): private student documents. Additive only: one new table, two helper functions.
-- The file itself lives in the private `student-docs` bucket; this table holds only the key, the kind, the size and the state. No document
-- content and no file name is ever stored here.
--
-- `pending` is one state more than architecture 24.2 lists: a row exists from the moment the upload link is signed, so an upload that never
-- completes is still found (and deleted) by the purge and by erasure. It becomes `uploaded` only after the object is verified.

CREATE TABLE public.student_document (
  id uuid PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.app_user(id),
  application_id uuid REFERENCES public.lead(id),
  kind text NOT NULL,
  -- `<student id>/<document id>`: never a file name. Cleared when the file is purged.
  storage_key text,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  rejection_note text,
  reviewed_by text REFERENCES public.app_user(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_document_kind_check CHECK (kind IN ('results', 'id', 'birth_certificate', 'signature', 'passport', 'offer_letter', 'acceptance_letter', 'payment_proof')),
  CONSTRAINT student_document_state_check CHECK (state IN ('pending', 'uploaded', 'approved', 'rejected', 'purged')),
  CONSTRAINT student_document_content_type_check CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  CONSTRAINT student_document_size_check CHECK (byte_size BETWEEN 1 AND 5242880),
  CONSTRAINT student_document_key_matches_state CHECK ((state = 'purged') = (storage_key IS NULL)),
  CONSTRAINT student_document_note_only_when_rejected CHECK (rejection_note IS NULL OR state IN ('rejected', 'purged'))
);
--> statement-breakpoint
CREATE INDEX student_document_student_state_idx ON public.student_document (student_id, state);
--> statement-breakpoint
CREATE INDEX student_document_application_idx ON public.student_document (application_id);
--> statement-breakpoint
-- One live copy of each document the student supplies. A new upload of the same kind replaces a pending or uploaded one (the signing
-- function does that); an approved one stays, and a rejected one is simply followed by a new upload.
CREATE UNIQUE INDEX student_document_one_live_per_kind ON public.student_document (student_id, kind)
  WHERE state IN ('pending', 'uploaded', 'approved') AND kind IN ('results', 'id', 'birth_certificate', 'signature', 'passport');
--> statement-breakpoint

ALTER TABLE public.student_document ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.student_document FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.student_document TO app_runtime;
--> statement-breakpoint

-- "May I see this student's file?": reads `student_profile` under its own policy (the admin, the assigned manager, the student), so the
-- rule of 24.2 is written once. Stable and invoker-rights, like `app_can_see_lead`.
CREATE OR REPLACE FUNCTION public.app_can_see_student(p_student_id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.student_profile sp WHERE sp.user_id = p_student_id) $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_can_see_student(text) TO app_runtime;
--> statement-breakpoint

-- Read: the student their own, staff the files of students they may see.
CREATE POLICY student_document_read ON public.student_document FOR SELECT TO app_runtime
  USING (student_id = public.app_current_user_id() OR (public.app_is_staff() AND public.app_can_see_student(student_id)));
--> statement-breakpoint
-- Insert: a student adds their own kinds, always pending. The admin adds a letter for a student, also pending until the file is checked.
CREATE POLICY student_document_insert ON public.student_document FOR INSERT TO app_runtime
  WITH CHECK (
    (student_id = public.app_current_user_id() AND state = 'pending'
       AND kind IN ('results', 'id', 'birth_certificate', 'signature', 'passport', 'payment_proof'))
    OR (public.app_is_admin() AND kind IN ('offer_letter', 'acceptance_letter') AND state = 'pending' AND public.app_can_see_student(student_id))
  );
--> statement-breakpoint
-- Update: the student on their own rows, staff on the rows of students they may see. WHICH change is allowed is the trigger's job below.
CREATE POLICY student_document_update ON public.student_document FOR UPDATE TO app_runtime
  USING (student_id = public.app_current_user_id() OR (public.app_is_staff() AND public.app_can_see_student(student_id)))
  WITH CHECK (student_id = public.app_current_user_id() OR (public.app_is_staff() AND public.app_can_see_student(student_id)));
--> statement-breakpoint

-- Which state changes a row may make, and who may make them. Everything else is refused, so a student cannot approve their own file and a
-- manager cannot touch a letter. The columns that say what the file IS never change after the row is made.
CREATE OR REPLACE FUNCTION public.app_student_document_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_me text := public.app_current_user_id();
BEGIN
  -- The rules below bind the Worker's runtime role. The migration owner and the security-definer functions that run the daily purge and the
  -- erasure (S17.3) are the system, and may purge a file whatever its state.
  IF current_user <> 'app_runtime' THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.student_id <> OLD.student_id OR NEW.kind <> OLD.kind OR NEW.content_type <> OLD.content_type OR NEW.byte_size <> OLD.byte_size
     OR NEW.created_at <> OLD.created_at OR (OLD.storage_key IS NOT NULL AND NEW.storage_key IS DISTINCT FROM OLD.storage_key AND NEW.state <> 'purged') THEN
    RAISE EXCEPTION 'student_document: the identity of a document cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;
  -- The student: confirms their own upload, or replaces one of their own that nobody has approved.
  IF OLD.student_id = v_me THEN
    IF (OLD.state = 'pending' AND NEW.state IN ('uploaded', 'purged')) OR (OLD.state IN ('uploaded', 'rejected') AND NEW.state = 'purged') THEN
      RETURN NEW;
    END IF;
  END IF;
  -- The admin: confirms a letter they uploaded, or puts a failed one aside.
  IF public.app_is_admin() AND OLD.kind IN ('offer_letter', 'acceptance_letter') AND OLD.state = 'pending' AND NEW.state IN ('uploaded', 'purged') THEN
    RETURN NEW;
  END IF;
  -- Staff: approve or reject a file the student supplied, once it is uploaded. Letters are not reviewed, and the proof of payment is the admin's to approve.
  IF public.app_is_staff() AND OLD.state = 'uploaded' AND NEW.state IN ('approved', 'rejected') AND OLD.kind NOT IN ('offer_letter', 'acceptance_letter')
     AND (OLD.kind <> 'payment_proof' OR public.app_is_admin()) THEN
    IF NEW.state = 'approved' AND NEW.rejection_note IS NOT NULL THEN
      RAISE EXCEPTION 'student_document: an approved document has no rejection note' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'student_document: this change is not allowed' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
CREATE TRIGGER student_document_guard BEFORE UPDATE ON public.student_document
  FOR EACH ROW EXECUTE FUNCTION public.app_student_document_guard();
--> statement-breakpoint

-- Step 2 to step 3 (architecture 24.4): the four documents a student supplies are all approved, and the passport too when the university asks.
CREATE OR REPLACE FUNCTION public.app_documents_complete(p_student_id text, p_passport_required boolean) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT (SELECT count(DISTINCT d.kind) FROM public.student_document d
           WHERE d.student_id = p_student_id AND d.state = 'approved' AND d.kind IN ('results', 'id', 'birth_certificate', 'signature')) = 4
         AND (NOT coalesce(p_passport_required, false)
              OR EXISTS (SELECT 1 FROM public.student_document d WHERE d.student_id = p_student_id AND d.state = 'approved' AND d.kind = 'passport'))
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_documents_complete(text, boolean) TO app_runtime;
