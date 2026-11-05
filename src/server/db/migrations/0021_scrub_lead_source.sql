-- Code review of Stage 0 to S15.7: erasing a lead must not leave a person's name behind. `lead.source` holds the contact name of the person who applied
-- (a parent's or the student's own, written by `app_complete_onboarding` since version 2 and `app_apply_from_profile` since version 4), and neither
-- erasure function (`app_erase_lead`, 0006; `app_erase_my_account`, 0013) touched it, so an anonymised lead still carried the name, and so did every
-- backup taken after that.
--
-- Additive only: one trigger function, one trigger and a one-time clean-up of leads already anonymised. The two erasure functions are not rewritten:
-- the trigger fires whenever a lead becomes anonymised, by either of them or by any later one. The page, course fields, relationship and level in
-- `source` stay (they are not personal data and the analytics read them).
CREATE OR REPLACE FUNCTION public.app_lead_scrub_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.source := NEW.source - 'contact_name';
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS app_lead_scrub_source ON public.lead;
--> statement-breakpoint
CREATE TRIGGER app_lead_scrub_source BEFORE UPDATE ON public.lead
  FOR EACH ROW WHEN (NEW.anonymised_at IS NOT NULL AND (NEW.source -> 'contact_name') IS NOT NULL)
  EXECUTE FUNCTION public.app_lead_scrub_source();
--> statement-breakpoint
UPDATE public.lead SET source = source - 'contact_name' WHERE anonymised_at IS NOT NULL AND (source -> 'contact_name') IS NOT NULL;
