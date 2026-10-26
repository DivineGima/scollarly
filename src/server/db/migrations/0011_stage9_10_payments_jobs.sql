-- Stages 9 and 10. Additive: no table or column changes, so there is no schema.ts change and the drift check stays quiet.

-- S9.1 / architecture 7.6: "Never updated except to void." Until now only the row level security policy and the CHECK constraints stood
-- between a staff member and an edited amount. Now the database refuses it, in three layers:
--   1. UPDATE is granted on the three void columns only (the runtime role cannot name any other column in an UPDATE).
--   2. The policy requires that a void is recorded as the person who made it.
--   3. A trigger refuses any change to the core columns, any second void, and any change to a voided row's void fields. The one other
--      change it allows is clearing `lead_id`, which erasure does (architecture 7.9); erasure runs as the function owner, not as the
--      runtime role, and it must also work for a payment that is already voided.
REVOKE UPDATE ON public.placement_payment FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (voided_at, voided_by, void_reason) ON public.placement_payment TO app_runtime;
--> statement-breakpoint
DROP POLICY IF EXISTS placement_payment_update ON public.placement_payment;
--> statement-breakpoint
CREATE POLICY placement_payment_update ON public.placement_payment FOR UPDATE TO app_runtime
  USING (public.app_is_staff())
  WITH CHECK (public.app_is_staff() AND voided_by = public.app_current_user_id());
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
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER placement_payment_guard BEFORE UPDATE ON public.placement_payment
  FOR EACH ROW EXECUTE FUNCTION public.placement_payment_guard();
--> statement-breakpoint

-- S10.2. The daily job records that it ran (and whether it worked) so the Health page can show the last run of each. The record is an
-- ordinary audit row with no actor (the system), so no table is added. The function is SECURITY DEFINER because the job runs with no
-- signed-in user, and it only accepts the two known job names and counts as detail.
CREATE OR REPLACE FUNCTION public.app_record_job(p_job text, p_ok boolean, p_detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_job NOT IN ('rollup', 'usage') THEN
    RAISE EXCEPTION 'Unknown job.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), NULL, 'job.' || p_job, 'job', p_job, jsonb_build_object('ok', p_ok) || coalesce(p_detail, '{}'::jsonb));
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_record_job(text, boolean, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_record_job(text, boolean, jsonb) TO app_runtime;
--> statement-breakpoint

-- S10.2. Three counters for the usage check and the Health page: how big the database is, how many image bytes are stored, and the image
-- budget (the setting, or 3.5 GiB when it is not a number). SECURITY DEFINER because the daily job has no signed-in user and
-- `pg_database_size` and the media table are not for a visitor to read directly. It returns sizes only, no row of any table.
CREATE OR REPLACE FUNCTION public.app_usage_snapshot() RETURNS TABLE (db_bytes bigint, image_bytes bigint, image_budget bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT pg_database_size(current_database()),
         coalesce((SELECT sum(m.bytes) FROM public.media_asset m), 0)::bigint,
         coalesce((SELECT CASE WHEN jsonb_typeof(s.value) = 'number' THEN (s.value #>> '{}')::numeric::bigint END FROM public.site_setting s WHERE s.key = 'media_budget_bytes'), 3758096384)::bigint
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_usage_snapshot() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_usage_snapshot() TO app_runtime;
