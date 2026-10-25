-- app_record_wa_taps: a bound on taps whose reference matches no lead.
-- A tap for a reference with no lead yet is kept with a null lead_id, so an offline-made lead can be linked when it arrives
-- (architecture 7.5). The per-reference daily cap did not bound those rows: every random reference is a new reference. A system-wide
-- daily cap on unlinked taps (p_unlinked_daily_cap, per WAT day) now bounds the table whatever references a script invents; taps over
-- it are dropped without an error, like taps over the per-reference cap. Linked taps (the reference matches a lead) are not counted here.
-- The old two-argument signature is dropped first so a two-argument call can never be ambiguous.
DROP FUNCTION IF EXISTS public.app_record_wa_taps(jsonb, integer);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_record_wa_taps(p_taps jsonb, p_daily_cap integer, p_unlinked_daily_cap integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tap jsonb;
  v_ref text;
  v_lead uuid;
  v_stored integer := 0;
  v_unlinked_today integer;
  -- The start of the current WAT day (UTC+1, no daylight saving), as a UTC instant.
  v_day_start timestamptz := date_trunc('day', now() + interval '1 hour') - interval '1 hour';
BEGIN
  SELECT count(*) INTO v_unlinked_today FROM public.event e WHERE e.type = 'wa_tap' AND e.lead_id IS NULL AND e.received_at >= v_day_start;

  FOR v_tap IN SELECT * FROM jsonb_array_elements(p_taps) LOOP
    v_ref := v_tap ->> 'lead_ref';
    CONTINUE WHEN v_ref IS NULL OR v_ref !~ '^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$';
    CONTINUE WHEN (SELECT count(*) FROM public.event e WHERE e.type = 'wa_tap' AND e.lead_ref = v_ref AND e.received_at >= v_day_start) >= p_daily_cap;

    v_lead := NULL;
    SELECT l.id INTO v_lead FROM public.lead l WHERE l.ref = v_ref OR l.client_ref = v_ref LIMIT 1;

    IF v_lead IS NULL THEN
      CONTINUE WHEN v_unlinked_today >= p_unlinked_daily_cap;
      v_unlinked_today := v_unlinked_today + 1;
    END IF;

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
REVOKE ALL ON FUNCTION public.app_record_wa_taps(jsonb, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_record_wa_taps(jsonb, integer, integer) TO app_runtime;
