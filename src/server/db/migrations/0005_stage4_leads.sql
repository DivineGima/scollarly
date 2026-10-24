-- Stage 4 (S4.4, S4.5): the two database functions behind lead intake and WhatsApp tap events. Additive only: two new
-- functions, no table or column changes. Both are SECURITY DEFINER with an empty search_path, run as the table owner so an
-- anonymous visitor needs no right to read or write leads or events (the runtime role has no INSERT on either table), and
-- are granted to app_runtime alone. Same pattern as app_create_phase0_lead (0002) and the Stage 2 functions (0004).

-- app_create_lead: one call that stores a lead idempotently (architecture 8.2, 10.1).
--   'existing'         the idempotency key was seen before; the caller compares stored_hash to tell a replay from a reused key
--   'number_limited'   the WhatsApp number already has p_number_limit leads in the last 24 hours (the second rate-limit layer)
--   'unknown_programme' a chosen programme does not exist
--   'ref_exhausted'    every candidate reference was taken (the caller retries with new candidates)
--   'created'          stored, with its programme preferences and the `created` activity; earlier wa_tap events for the
--                      same reference are linked to the lead
-- The first candidate reference is the one the device made. If another lead has it, the next candidate is used and the
-- device value stays in client_ref (architecture 10.1), so admins can search either.
CREATE OR REPLACE FUNCTION public.app_create_lead(
  p_id uuid,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_refs text[],
  p_client_ref text,
  p_name text,
  p_whatsapp text,
  p_country text,
  p_email text,
  p_intake_kind text,
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
  p_programme_ids uuid[],
  p_number_limit integer
) RETURNS TABLE (out_outcome text, out_lead_id uuid, out_lead_ref text, out_stored_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_existing record;
  v_ref text;
  v_constraint text;
  v_count integer;
  v_wanted integer;
  v_found integer;
BEGIN
  SELECT l.id, l.ref, l.payload_hash INTO v_existing FROM public.lead l WHERE l.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.ref, v_existing.payload_hash;
    RETURN;
  END IF;

  SELECT count(*) INTO v_count FROM public.lead l
   WHERE l.whatsapp_e164 = p_whatsapp AND l.received_at > p_received_at - interval '24 hours';
  IF v_count >= p_number_limit THEN
    RETURN QUERY SELECT 'number_limited'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_programme_ids IS NOT NULL AND cardinality(p_programme_ids) > 0 THEN
    SELECT count(DISTINCT x) INTO v_wanted FROM unnest(p_programme_ids) AS x;
    SELECT count(*) INTO v_found FROM public.programme pr WHERE pr.id = ANY (p_programme_ids);
    IF v_found <> v_wanted THEN
      RETURN QUERY SELECT 'unknown_programme'::text, NULL::uuid, NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  FOREACH v_ref IN ARRAY p_refs LOOP
    BEGIN
      INSERT INTO public.lead (
        id, ref, client_ref, idempotency_key, payload_hash, name, whatsapp_e164, country_code, email, intake_kind,
        qualification_type, results, source, locale, consent_notice_version, consent_at, client_created_at,
        received_at, sla_due_at, sla_hours_applied, last_activity_at
      ) VALUES (
        p_id, v_ref, p_client_ref, p_idempotency_key, p_payload_hash, p_name, p_whatsapp, p_country, p_email, p_intake_kind,
        p_qualification, p_results, p_source, p_locale, p_consent_version, p_consent_at, p_client_created_at,
        p_received_at, p_sla_due_at, p_sla_hours, p_received_at
      );

      IF p_programme_ids IS NOT NULL AND cardinality(p_programme_ids) > 0 THEN
        INSERT INTO public.lead_programme_pref (lead_id, programme_id, rank)
        SELECT p_id, x.programme_id, x.ordinality::integer
          FROM unnest(p_programme_ids) WITH ORDINALITY AS x(programme_id, ordinality);
      END IF;

      -- The activity holds ids and codes only, never free text (ADR-007).
      INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data, created_at)
      VALUES (gen_random_uuid(), p_id, 'created', NULL, jsonb_build_object('intake_kind', p_intake_kind, 'stage', 'share_results'), p_received_at);

      -- Taps that arrived before the lead did (offline) now belong to it.
      UPDATE public.event SET lead_id = p_id
       WHERE lead_id IS NULL AND lead_ref IN (v_ref, p_client_ref);

      RETURN QUERY SELECT 'created'::text, p_id, v_ref, p_payload_hash;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'lead_idempotency_key_unique' THEN
        -- A concurrent request with the same key stored it first: that is a replay.
        SELECT l.id, l.ref, l.payload_hash INTO v_existing FROM public.lead l WHERE l.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.ref, v_existing.payload_hash;
        RETURN;
      END IF;
      -- lead_ref_unique: another lead has this reference; try the next candidate.
    END;
  END LOOP;

  RETURN QUERY SELECT 'ref_exhausted'::text, NULL::uuid, NULL::text, NULL::text;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_create_lead(uuid, uuid, text, text[], text, text, text, text, text, text, text, jsonb, jsonb, text, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, uuid[], integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_create_lead(uuid, uuid, text, text[], text, text, text, text, text, text, text, jsonb, jsonb, text, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, uuid[], integer) TO app_runtime;
--> statement-breakpoint

-- app_record_wa_taps: stores `wa_tap` events that carry a lead reference, at most p_daily_cap per reference per WAT day
-- (architecture 7.5, 10.2; owner decision D7). Taps over the cap are dropped without an error. A reference with no lead yet
-- is stored with a null lead_id and linked when the lead arrives (app_create_lead). Returns how many rows were stored.
-- Page views, form events and installs are never stored here: they are counts in the collector.
CREATE OR REPLACE FUNCTION public.app_record_wa_taps(p_taps jsonb, p_daily_cap integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tap jsonb;
  v_ref text;
  v_lead uuid;
  v_stored integer := 0;
  -- The start of the current WAT day (UTC+1, no daylight saving), as a UTC instant.
  v_day_start timestamptz := date_trunc('day', now() + interval '1 hour') - interval '1 hour';
BEGIN
  FOR v_tap IN SELECT * FROM jsonb_array_elements(p_taps) LOOP
    v_ref := v_tap ->> 'lead_ref';
    CONTINUE WHEN v_ref IS NULL OR v_ref !~ '^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$';
    CONTINUE WHEN (SELECT count(*) FROM public.event e WHERE e.type = 'wa_tap' AND e.lead_ref = v_ref AND e.received_at >= v_day_start) >= p_daily_cap;

    v_lead := NULL;
    SELECT l.id INTO v_lead FROM public.lead l WHERE l.ref = v_ref OR l.client_ref = v_ref LIMIT 1;

    INSERT INTO public.event (id, type, session_id, lead_ref, lead_id, university_id, page_group, country, occurred_at)
    VALUES (
      gen_random_uuid(),
      'wa_tap',
      left(v_tap ->> 'session_id', 64),
      v_ref,
      v_lead,
      (SELECT u.id FROM public.university u WHERE u.id = nullif(v_tap ->> 'university_id', '')::uuid),
      left(v_tap ->> 'page_group', 40),
      CASE WHEN (v_tap ->> 'country') ~ '^[A-Z]{2}$' THEN v_tap ->> 'country' ELSE NULL END,
      nullif(v_tap ->> 'occurred_at', '')::timestamptz
    );
    v_stored := v_stored + 1;
  END LOOP;
  RETURN v_stored;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_record_wa_taps(jsonb, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_record_wa_taps(jsonb, integer) TO app_runtime;
