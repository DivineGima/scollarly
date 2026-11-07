-- Migration 0026 (version 5, architecture 24.7, S18.2): the moment a student last did something, so "gone quiet" (14 days) and "suggest closing"
-- (45 days) have something true to be computed from. `lead.last_student_activity_at` has existed since 0023 but nothing wrote to it after the
-- lead was made, so every file would have turned quiet 14 days after it began. Additive only: two functions and two triggers, no column and no data change.
--
-- It counts what the STUDENT does, never what staff do to the student's file: a trigger acts only when the signed-in person is the student
-- the row belongs to (`app_current_user_id()`), so a manager approving a document, an admin uploading a letter or a reassignment changes nothing.
-- Both functions run with the owner's rights because a student may not update `lead` directly; they touch only that student's own open lead.

CREATE OR REPLACE FUNCTION public.app_touch_student_activity(p_student_id text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.lead SET last_student_activity_at = now()
   WHERE user_id = p_student_id AND status = 'open' AND merged_into_id IS NULL AND anonymised_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_touch_student_activity(text) FROM PUBLIC;
--> statement-breakpoint

-- A document the student sends (it appears as `pending` when the link is signed and becomes `uploaded` when it is checked).
CREATE OR REPLACE FUNCTION public.app_student_document_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.student_id = public.app_current_user_id() AND NEW.state IN ('pending', 'uploaded') THEN
    PERFORM public.app_touch_student_activity(NEW.student_id);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER student_document_activity AFTER INSERT OR UPDATE OF state ON public.student_document
  FOR EACH ROW EXECUTE FUNCTION public.app_student_document_activity();
--> statement-breakpoint

-- The student saving their own form.
CREATE OR REPLACE FUNCTION public.app_student_profile_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id = public.app_current_user_id() THEN
    PERFORM public.app_touch_student_activity(NEW.user_id);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER student_profile_activity AFTER UPDATE ON public.student_profile
  FOR EACH ROW EXECUTE FUNCTION public.app_student_profile_activity();
