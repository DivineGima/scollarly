CREATE TABLE "student_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"relationship" text NOT NULL,
	"applicant_name" text NOT NULL,
	"applicant_country" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_whatsapp_e164" text NOT NULL,
	"qualification_type" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"level" text NOT NULL,
	"course_fields" text[] NOT NULL,
	"intake_year" smallint NOT NULL,
	"consent_notice_version" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"lead_id" uuid,
	"onboarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profile_relationship_check" CHECK ("student_profile"."relationship" in ('student', 'parent')),
	CONSTRAINT "student_profile_level_check" CHECK ("student_profile"."level" in ('undergraduate', 'postgraduate')),
	CONSTRAINT "student_profile_qualification_type_check" CHECK ("student_profile"."qualification_type" in ('olevel_alevel', 'grade10_11')),
	CONSTRAINT "student_profile_country_format" CHECK ("student_profile"."applicant_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "student_profile_whatsapp_format" CHECK ("student_profile"."contact_whatsapp_e164" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "student_profile_results_is_array" CHECK (jsonb_typeof("student_profile"."results") = 'array'),
	CONSTRAINT "student_profile_course_fields_count" CHECK (cardinality("student_profile"."course_fields") between 1 and 5),
	CONSTRAINT "student_profile_course_fields_known" CHECK ("student_profile"."course_fields" <@ ARRAY['computer_science_it', 'mechanical_engineering', 'civil_engineering', 'electrical_electronics_engineering', 'electronics_communication_engineering', 'engineering_postgraduate', 'business_management', 'commerce', 'pharmacy', 'health_nursing', 'science_arts', 'law']::text[]),
	CONSTRAINT "student_profile_intake_year_range" CHECK ("student_profile"."intake_year" between 2020 and 2100)
);
--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT "lead_intake_kind_check";--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT "lead_quick_has_no_results";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "account_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "notifications_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "tours_seen" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_profile_lead_id_idx" ON "student_profile" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_intake_kind_check" CHECK ("lead"."intake_kind" in ('full', 'quick', 'onboarding'));--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_quick_has_no_results" CHECK ("lead"."intake_kind" <> 'quick' or "lead"."results" = '[]'::jsonb);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Version 2 refactor (architecture 21.2, 21.3, 21.8, 21.10; ADR-041 to ADR-045). Additive: new columns, a new table, new
-- functions, one widened check (above). Nothing is dropped except the two lead checks that are re-added with wider text.
-- ---------------------------------------------------------------------------------------------

-- Every account that exists today stays an account (ADR-042). Only logins created after this migration start unconfirmed.
UPDATE public.app_user SET account_confirmed_at = created_at WHERE account_confirmed_at IS NULL;
--> statement-breakpoint

-- A staff account is always confirmed: promoting a user (owner bootstrap, accepted invite) or creating a row that is already admin or
-- owner confirms it in the same statement, without touching those functions.
CREATE OR REPLACE FUNCTION public.app_user_confirm_on_promotion() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.role IN ('admin', 'owner') AND NEW.account_confirmed_at IS NULL AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role) THEN
    NEW.account_confirmed_at := now();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS app_user_confirm_on_promotion ON public.app_user;
--> statement-breakpoint
CREATE TRIGGER app_user_confirm_on_promotion BEFORE INSERT OR UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.app_user_confirm_on_promotion();
--> statement-breakpoint

-- student_profile: a user reads and writes their own row, staff read all, nobody deletes (erasure deletes it through app_erase_my_account).
ALTER TABLE public.student_profile ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.student_profile FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.student_profile TO app_runtime;
--> statement-breakpoint
CREATE POLICY student_profile_select ON public.student_profile FOR SELECT TO app_runtime
  USING (user_id = public.app_current_user_id() OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY student_profile_insert ON public.student_profile FOR INSERT TO app_runtime
  WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY student_profile_update ON public.student_profile FOR UPDATE TO app_runtime
  USING (user_id = public.app_current_user_id()) WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint

-- The one query the facade runs per request, now also saying whether the account is confirmed (ADR-034, ADR-042). It wraps the
-- existing function, so the first-sign-in insert and the session checks are unchanged; a row created by this very call reads as
-- not confirmed, which is correct.
CREATE OR REPLACE FUNCTION public.app_resolve_session_v2(p_token text)
RETURNS TABLE (user_id text, session_id text, email text, email_verified boolean, role text, step_up_at timestamptz, account_confirmed boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.user_id, s.session_id, s.email, s.email_verified, s.role, s.step_up_at, coalesce(a.account_confirmed_at IS NOT NULL, false)
    FROM public.app_resolve_session(p_token) s
    LEFT JOIN public.app_user a ON a.id = s.user_id
$$;
--> statement-breakpoint

-- Create account: the caller confirms their own Scollarly account. Idempotent. Returns true only the first time.
CREATE OR REPLACE FUNCTION public.app_confirm_account() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
  v_changed integer;
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_user SET account_confirmed_at = now() WHERE id = v_user AND account_confirmed_at IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed > 0 THEN
    INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
      VALUES (gen_random_uuid(), v_user, 'account.confirmed', 'app_user', v_user, '{}'::jsonb);
  END IF;
  RETURN v_changed > 0;
END
$$;
--> statement-breakpoint

-- "Mark all read": moves only the caller's own last-seen time. A user can never change their role through these functions.
CREATE OR REPLACE FUNCTION public.app_mark_notifications_seen() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_user SET notifications_seen_at = now() WHERE id = v_user;
END
$$;
--> statement-breakpoint

-- First-visit tour: records that the caller has seen the tour of one tab. A tab key is a short lowercase word; at most 20 are kept.
CREATE OR REPLACE FUNCTION public.app_mark_tour_seen(p_tab text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  IF p_tab IS NULL OR p_tab !~ '^[a-z]{2,20}$' THEN
    RAISE EXCEPTION 'Unknown tab.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.app_user
     SET tours_seen = array_append(tours_seen, p_tab)
   WHERE id = v_user AND NOT (p_tab = ANY (tours_seen)) AND cardinality(tours_seen) < 20;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_resolve_session_v2(text), public.app_confirm_account(), public.app_mark_notifications_seen(), public.app_mark_tour_seen(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_resolve_session_v2(text), public.app_confirm_account(), public.app_mark_notifications_seen(), public.app_mark_tour_seen(text) TO app_runtime;
--> statement-breakpoint

-- Erasure now also removes the student's onboarding answers (the only change to this function is one DELETE).
CREATE OR REPLACE FUNCTION public.app_erase_my_account(p_token text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
  v_role text;
  v_created timestamptz;
  v_ids uuid[];
  v_refs text[];
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  SELECT a.role INTO v_role FROM public.app_user a WHERE a.id = v_user;
  IF v_role IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF v_role <> 'student' THEN
    RETURN 'staff_account';
  END IF;
  SELECT s."createdAt" INTO v_created FROM neon_auth.session s WHERE s.token = p_token AND s."userId"::text = v_user AND s."expiresAt" > now();
  IF v_created IS NULL OR v_created < now() - interval '10 minutes' THEN
    RETURN 'reauth_required';
  END IF;

  SELECT array_agg(l.id), array_agg(l.ref) || array_agg(l.client_ref)
    INTO v_ids, v_refs
    FROM public.lead l
   WHERE (l.user_id = v_user OR l.merged_into_id IN (SELECT m.id FROM public.lead m WHERE m.user_id = v_user)) AND l.anonymised_at IS NULL;

  IF v_ids IS NOT NULL THEN
    UPDATE public.lead
       SET name = NULL, whatsapp_e164 = NULL, email = NULL, results = '[]'::jsonb, user_id = NULL,
           anonymised_at = now(), last_activity_at = now()
     WHERE id = ANY (v_ids);
    UPDATE public.lead_note SET body = '[erased]', erased_at = now() WHERE lead_id = ANY (v_ids) AND erased_at IS NULL;
    UPDATE public.lead_claim SET reject_reason = NULL WHERE lead_id = ANY (v_ids) AND reject_reason IS NOT NULL;
    UPDATE public.event SET lead_ref = NULL, lead_id = NULL WHERE lead_id = ANY (v_ids) OR lead_ref = ANY (v_refs);
    UPDATE public.placement_payment SET lead_id = NULL WHERE lead_id = ANY (v_ids);
    INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
      SELECT gen_random_uuid(), id, 'anonymised', NULL, jsonb_build_object('by', 'student') FROM unnest(v_ids) AS id;
  END IF;

  DELETE FROM public.lead_claim WHERE user_id = v_user;
  DELETE FROM public.step_up WHERE user_id = v_user;
  -- Version 2 (migration 0013): the onboarding answers are personal data and go with the account (erasure carve-out, architecture 7.9).
  DELETE FROM public.student_profile WHERE user_id = v_user;
  DELETE FROM public.app_user WHERE id = v_user;
  IF to_regclass('neon_auth.account') IS NOT NULL THEN
    EXECUTE 'DELETE FROM neon_auth.account WHERE "userId"::text = $1' USING v_user;
  END IF;
  DELETE FROM neon_auth.session WHERE "userId"::text = v_user;
  DELETE FROM neon_auth."user" WHERE id::text = v_user;

  INSERT INTO public.data_request (id, kind, user_id, channel, status, completed_at)
    VALUES (gen_random_uuid(), 'erasure', v_user, 'portal', 'done', now());
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'student.requestErasure', 'app_user', v_user,
            jsonb_build_object('leads_erased', coalesce(array_length(v_ids, 1), 0)));
  RETURN 'erased';
END
$$;
