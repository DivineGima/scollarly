-- Review of Stages 6 to 8: two limits that counted the wrong thing. Both are CREATE OR REPLACE of functions from 0009, so the
-- change is additive-first (no table, column or grant changes).

-- S8.2 / A12. The first version limited the claims it created, so a request that matched nothing was never counted (unlimited
-- guessing of references and numbers) and, once a few guesses had matched, the answer changed to `rate_limited`, which told the
-- student that earlier guesses had matched (architecture 9.6: the same answer whether or not a lead matched).
-- Now every request counts, whatever it matched: at most 10 requests a day per account, recorded as an audit row that holds no
-- reference and no number. The number of pending claims is capped separately at 5, and that cap never changes the answer.
-- Outcomes: sent, rate_limited.
CREATE OR REPLACE FUNCTION public.app_request_link(p_ref text, p_number text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
  v_method text;
  v_room integer;
BEGIN
  IF v_user IS NULL OR v_user = '' OR NOT EXISTS (SELECT 1 FROM public.app_user WHERE id = v_user) THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.audit_log a WHERE a.actor_id = v_user AND a.action = 'student.requestLink' AND a.at > now() - interval '24 hours') >= 10 THEN
    RETURN 'rate_limited';
  END IF;
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'student.requestLink', 'app_user', v_user, '{}'::jsonb);

  v_room := 5 - (SELECT count(*) FROM public.lead_claim c WHERE c.user_id = v_user AND c.status = 'pending')::integer;
  IF v_room > 0 THEN
    v_method := CASE WHEN p_ref IS NOT NULL THEN 'ref' ELSE 'number' END;
    INSERT INTO public.lead_claim (id, user_id, lead_id, method, status)
      SELECT gen_random_uuid(), v_user, l.id, v_method, 'pending'
        FROM public.lead l
       WHERE l.anonymised_at IS NULL AND l.merged_into_id IS NULL AND l.user_id IS NULL
         AND ((p_ref IS NOT NULL AND (l.ref = p_ref OR l.client_ref = p_ref)) OR (p_ref IS NULL AND p_number IS NOT NULL AND l.whatsapp_e164 = p_number))
         AND NOT EXISTS (SELECT 1 FROM public.lead_claim c WHERE c.user_id = v_user AND c.lead_id = l.id AND c.status = 'pending')
       ORDER BY l.received_at DESC
       LIMIT LEAST(3, v_room);
  END IF;
  RETURN 'sent';
END
$$;
--> statement-breakpoint

-- S8.3 / A13 step 2. The first version wrote a `data_request` row and an audit row on every call, so a loop could fill both
-- tables. A student's export is now logged once an hour; a repeat inside the hour still returns the data (the caller reads it)
-- and writes nothing more.
CREATE OR REPLACE FUNCTION public.app_log_my_export() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.data_request d WHERE d.user_id = v_user AND d.kind = 'export' AND d.created_at > now() - interval '1 hour') THEN
    RETURN;
  END IF;
  INSERT INTO public.data_request (id, kind, user_id, channel, status, completed_at)
    VALUES (gen_random_uuid(), 'export', v_user, 'portal', 'done', now());
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_user, 'student.exportData', 'app_user', v_user, '{}'::jsonb);
END
$$;
