ALTER TABLE "lead_claim" DROP CONSTRAINT "lead_claim_approval_needs_method";--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "rolled_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_claim" ADD CONSTRAINT "lead_claim_approval_needs_method" CHECK ("lead_claim"."status" <> 'approved' or "lead_claim"."verification_method" is not null or "lead_claim"."method" = 'auto');
--> statement-breakpoint

-- Stages 6 to 8 (S6.2, S7.1, S8.2, S8.3). Additive: one nullable column, one CHECK loosened for system-made links (both above),
-- one trigger and six SECURITY DEFINER functions with an empty search_path, granted to app_runtime alone. Same pattern as
-- 0004 to 0006. The functions that act for a signed-in person read the caller from the row level security context
-- (`app_current_user_id()`), which the caller sets in the same transaction.

-- S6.2 (FR-13): a testimonial or journey cannot be published against a consent that was revoked. The CHECKs of 0003 already need
-- a consent record to exist; this trigger adds "and it is still in force". Revoking a consent unpublishes its dependants in the
-- service, so this only fires if a stale screen tries to publish after the revoke.
CREATE OR REPLACE FUNCTION public.app_consent_must_be_in_force() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.consent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.consent_record c WHERE c.id = NEW.consent_id AND c.revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The consent for this item was revoked.' USING ERRCODE = '23514', CONSTRAINT = 'consent_in_force';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER testimonial_consent_in_force BEFORE INSERT OR UPDATE ON public.testimonial
  FOR EACH ROW EXECUTE FUNCTION public.app_consent_must_be_in_force();
--> statement-breakpoint
CREATE TRIGGER journey_consent_in_force BEFORE INSERT OR UPDATE ON public.journey
  FOR EACH ROW EXECUTE FUNCTION public.app_consent_must_be_in_force();
--> statement-breakpoint

-- S7.1: add a batch of anonymous counts to the daily table. `p_counts` is a JSON array of
-- { date, type, country, university_id, page_group, count }. Additive: running it twice adds twice, so the caller drains its
-- source first (the collector hands each count out once). An unknown university id is stored as "none" rather than failing the batch.
CREATE OR REPLACE FUNCTION public.app_rollup_counts(p_counts jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF jsonb_typeof(p_counts) IS DISTINCT FROM 'array' THEN
    RETURN 0;
  END IF;
  INSERT INTO public.event_daily_agg (date, type, country, university_id, page_group, count)
    SELECT x.date, x.type, x.country, u.id, x.page_group, sum(x.count)
      FROM jsonb_to_recordset(p_counts) AS x(date date, type text, country text, university_id uuid, page_group text, count bigint)
      LEFT JOIN public.university u ON u.id = x.university_id
     WHERE x.count > 0
     GROUP BY x.date, x.type, x.country, u.id, x.page_group
  ON CONFLICT ON CONSTRAINT event_daily_agg_key DO UPDATE SET count = public.event_daily_agg.count + EXCLUDED.count;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$$;
--> statement-breakpoint

-- S7.1: count the raw rows (the `wa_tap` events that carry a lead reference) into the daily table exactly once, then purge the
-- rows that were counted more than 30 days ago (architecture 7.5, ADR-029 carve-out). Only whole WAT days before `p_today`
-- (a WAT date) are counted, so a day is never counted twice. Returns { counted, purged }.
CREATE OR REPLACE FUNCTION public.app_rollup_raw_events(p_today date) RETURNS TABLE (out_counted integer, out_purged integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_counted integer;
  v_purged integer;
BEGIN
  WITH due AS (
    SELECT e.id, (e.received_at AT TIME ZONE 'Africa/Douala')::date AS wat_date, e.type, e.country, e.university_id, e.page_group
      FROM public.event e
     WHERE e.rolled_up_at IS NULL AND (e.received_at AT TIME ZONE 'Africa/Douala')::date < p_today
       FOR UPDATE
  ), agg AS (
    INSERT INTO public.event_daily_agg (date, type, country, university_id, page_group, count)
      SELECT d.wat_date, d.type, d.country, d.university_id, d.page_group, count(*) FROM due d
       GROUP BY d.wat_date, d.type, d.country, d.university_id, d.page_group
    ON CONFLICT ON CONSTRAINT event_daily_agg_key DO UPDATE SET count = public.event_daily_agg.count + EXCLUDED.count
    RETURNING 1
  ), marked AS (
    UPDATE public.event e SET rolled_up_at = now() FROM due WHERE e.id = due.id RETURNING 1
  )
  SELECT count(*)::integer INTO v_counted FROM marked;

  DELETE FROM public.event WHERE rolled_up_at IS NOT NULL AND rolled_up_at < now() - interval '30 days';
  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN QUERY SELECT v_counted, v_purged;
END
$$;
--> statement-breakpoint

-- S8.2: a lead created while a student is signed in is linked to that account, as an approved `auto` claim, at once. The caller
-- is the lead endpoint, right after it stored the lead. Only a session of a `student` account links (a staff member filling in
-- the form for someone else must not take the lead), only a lead made in the last two minutes, and only one with no account yet.
CREATE OR REPLACE FUNCTION public.app_link_new_lead(p_lead_id uuid, p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text;
BEGIN
  SELECT s."userId"::text INTO v_user
    FROM neon_auth.session s
    JOIN neon_auth."user" u ON u.id = s."userId"
    JOIN public.app_user a ON a.id = s."userId"::text
   WHERE s.token = p_token AND s."expiresAt" > now() AND coalesce(u.banned, false) = false AND u."emailVerified" AND a.role = 'student';
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.lead SET user_id = v_user, last_activity_at = now()
   WHERE id = p_lead_id AND user_id IS NULL AND anonymised_at IS NULL AND merged_into_id IS NULL
     AND received_at > now() - interval '2 minutes';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.lead_claim (id, user_id, lead_id, method, status, decided_at)
    VALUES (gen_random_uuid(), v_user, p_lead_id, 'auto', 'approved', now());
  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    VALUES (gen_random_uuid(), p_lead_id, 'claimed', NULL, jsonb_build_object('method', 'auto'));
  RETURN true;
END
$$;
--> statement-breakpoint

-- S8.2 / A12: the student asks to link an application, by its reference or by the WhatsApp number it was made with. It creates a
-- `pending` claim for an admin to decide (architecture 9.6); nothing is linked here. The answer is `sent` whether or not a lead
-- matched, so the form cannot be used to find out which references or numbers exist. At most 5 claims a day per account.
-- Outcomes: sent, rate_limited.
CREATE OR REPLACE FUNCTION public.app_request_link(p_ref text, p_number text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
  v_method text;
BEGIN
  IF v_user IS NULL OR v_user = '' OR NOT EXISTS (SELECT 1 FROM public.app_user WHERE id = v_user) THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.lead_claim c WHERE c.user_id = v_user AND c.created_at > now() - interval '24 hours') >= 5 THEN
    RETURN 'rate_limited';
  END IF;

  v_method := CASE WHEN p_ref IS NOT NULL THEN 'ref' ELSE 'number' END;
  INSERT INTO public.lead_claim (id, user_id, lead_id, method, status)
    SELECT gen_random_uuid(), v_user, l.id, v_method, 'pending'
      FROM public.lead l
     WHERE l.anonymised_at IS NULL AND l.merged_into_id IS NULL AND l.user_id IS NULL
       AND ((p_ref IS NOT NULL AND (l.ref = p_ref OR l.client_ref = p_ref)) OR (p_ref IS NULL AND p_number IS NOT NULL AND l.whatsapp_e164 = p_number))
       AND NOT EXISTS (SELECT 1 FROM public.lead_claim c WHERE c.user_id = v_user AND c.lead_id = l.id AND c.status = 'pending')
     ORDER BY l.received_at DESC
     LIMIT 3;
  RETURN 'sent';
END
$$;
--> statement-breakpoint

-- S8.3 / A13 step 2: the export of a student's own data is logged as a done `data_request` and an audit row, in the same
-- transaction as the read (architecture 10.8). The data itself is read by the caller under row level security.
CREATE OR REPLACE FUNCTION public.app_log_my_export() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.data_request (id, kind, user_id, channel, status, completed_at)
    VALUES (gen_random_uuid(), 'export', v_user, 'portal', 'done', now());
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'student.exportData', 'app_user', v_user, '{}'::jsonb);
END
$$;
--> statement-breakpoint

-- S8.3 / A13 step 3: self-service erasure. In one transaction: anonymise every lead linked to the account (the same changes as
-- `app_erase_lead`), delete the account's link requests, step-up rows and `app_user` row, end and delete its Neon Auth
-- rows, keep payments without the link, and write the done `data_request` and the audit row. It needs a sign-in in the last
-- 10 minutes (the session's own creation time), and only a `student` account may use it: a staff member is removed by the owner first.
-- Outcomes: erased, reauth_required, staff_account, not_found.
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
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_consent_must_be_in_force() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_rollup_counts(jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_rollup_raw_events(date) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_link_new_lead(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_request_link(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_log_my_export() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_erase_my_account(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  public.app_rollup_counts(jsonb),
  public.app_rollup_raw_events(date),
  public.app_link_new_lead(uuid, text),
  public.app_request_link(text, text),
  public.app_log_my_export(),
  public.app_erase_my_account(text)
TO app_runtime;
