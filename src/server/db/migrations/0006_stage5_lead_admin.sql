-- Stage 5 (S5.1 to S5.6): admin lead management. Additive only: two nullable-or-defaulted columns, one trigger and five
-- SECURITY DEFINER functions (empty search_path, staff only, granted to app_runtime alone). Same pattern as 0004 and 0005.
--
-- lead.updated_at is the version a screen carries when it saves (architecture 13.6). A trigger moves it forward whenever
-- anything except last_activity_at changes, so a note or a logged reply (which only move last_activity_at) never makes
-- someone else's stage change fail with "This lead changed".
ALTER TABLE "lead" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_claim" ADD COLUMN "reject_reason" text;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_lead_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'last_activity_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'last_activity_at' - 'updated_at') THEN
    -- Strictly newer than the old value even inside one transaction, so two quick changes never share a version.
    NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER lead_touch_updated_at BEFORE UPDATE ON public.lead
  FOR EACH ROW EXECUTE FUNCTION public.app_lead_touch_updated_at();
--> statement-breakpoint

-- B4 (architecture 9.6): decide a student's link request. Approving needs a verification method, and 'email_match' is checked
-- here against the verified email of the claiming account, so the admin cannot tick it by mistake. Everything commits together
-- or not at all. Outcomes: approved, rejected, not_found, not_pending, method_required, email_mismatch, lead_unavailable
-- (erased or merged away), already_linked (the lead belongs to another account).
CREATE OR REPLACE FUNCTION public.app_decide_claim(p_claim_id uuid, p_decision text, p_method text, p_reason text)
RETURNS TABLE (out_outcome text, out_lead_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := public.app_current_user_id();
  v_claim public.lead_claim%ROWTYPE;
  v_lead public.lead%ROWTYPE;
  v_email text;
  v_verified boolean;
BEGIN
  IF NOT public.app_is_staff() OR v_actor IS NULL OR v_actor = '' THEN
    RAISE EXCEPTION 'Only staff can decide a link request.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_claim FROM public.lead_claim WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_claim.status <> 'pending' THEN
    RETURN QUERY SELECT 'not_pending'::text, v_claim.lead_id;
    RETURN;
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.lead_claim
       SET status = 'rejected', decided_by = v_actor, decided_at = now(), reject_reason = left(btrim(coalesce(p_reason, '')), 200)
     WHERE id = p_claim_id;
    INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
      VALUES (gen_random_uuid(), v_actor, 'leads.decideClaim', 'lead_claim', p_claim_id::text,
              jsonb_build_object('decision', 'rejected', 'lead_id', v_claim.lead_id));
    RETURN QUERY SELECT 'rejected'::text, v_claim.lead_id;
    RETURN;
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('email_match', 'whatsapp_confirmed') THEN
    RETURN QUERY SELECT 'method_required'::text, v_claim.lead_id;
    RETURN;
  END IF;

  SELECT * INTO v_lead FROM public.lead WHERE id = v_claim.lead_id FOR UPDATE;
  IF NOT FOUND OR v_lead.anonymised_at IS NOT NULL OR v_lead.merged_into_id IS NOT NULL THEN
    RETURN QUERY SELECT 'lead_unavailable'::text, v_claim.lead_id;
    RETURN;
  END IF;
  IF v_lead.user_id IS NOT NULL AND v_lead.user_id <> v_claim.user_id THEN
    RETURN QUERY SELECT 'already_linked'::text, v_claim.lead_id;
    RETURN;
  END IF;

  IF p_method = 'email_match' THEN
    SELECT lower(u.email), u."emailVerified" INTO v_email, v_verified FROM neon_auth."user" u WHERE u.id::text = v_claim.user_id;
    IF v_lead.email IS NULL OR v_email IS NULL OR NOT coalesce(v_verified, false) OR v_email <> lower(v_lead.email) THEN
      RETURN QUERY SELECT 'email_mismatch'::text, v_claim.lead_id;
      RETURN;
    END IF;
  END IF;

  UPDATE public.lead_claim
     SET status = 'approved', verification_method = p_method, decided_by = v_actor, decided_at = now()
   WHERE id = p_claim_id;
  UPDATE public.lead SET user_id = v_claim.user_id, last_activity_at = now() WHERE id = v_claim.lead_id;
  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    VALUES (gen_random_uuid(), v_claim.lead_id, 'claimed', v_actor,
            jsonb_build_object('claim_id', p_claim_id, 'method', v_claim.method, 'verification_method', p_method));
  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_actor, 'leads.decideClaim', 'lead_claim', p_claim_id::text,
            jsonb_build_object('decision', 'approved', 'verification_method', p_method, 'lead_id', v_claim.lead_id));
  RETURN QUERY SELECT 'approved'::text, v_claim.lead_id;
END
$$;
--> statement-breakpoint

-- B4 step 1: pending link requests with the claiming account's name and email, which live in Neon Auth's tables.
CREATE OR REPLACE FUNCTION public.app_list_claims()
RETURNS TABLE (claim_id uuid, method text, created_at timestamptz, user_id text, user_name text, user_email text, email_verified boolean,
               lead_id uuid, lead_ref text, lead_name text, lead_country text, lead_email_matches boolean, lead_linked_to_other boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT c.id, c.method, c.created_at, c.user_id, u.name, u.email, u."emailVerified",
           l.id, l.ref, l.name, l.country_code,
           (l.email IS NOT NULL AND u."emailVerified" AND lower(l.email) = lower(u.email)),
           (l.user_id IS NOT NULL AND l.user_id <> c.user_id)
      FROM public.lead_claim c
      JOIN public.lead l ON l.id = c.lead_id
      LEFT JOIN neon_auth."user" u ON u.id::text = c.user_id
     WHERE c.status = 'pending'
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT 100;
END
$$;
--> statement-breakpoint

-- B3 steps 9 to 10 (architecture 7.2): merge two leads with the same WhatsApp number, or record that they are not duplicates.
-- Never automatic: only an admin calls this. Merging sets merged_into_id on the other lead (nothing is deleted), re-points
-- anything already merged into it, and writes the decision, an activity on each lead and an audit row. Outcomes: merged,
-- dismissed, not_found, not_a_pair (same lead, different numbers, erased or already merged away), already_decided.
CREATE OR REPLACE FUNCTION public.app_resolve_duplicate(p_keep uuid, p_other uuid, p_decision text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := public.app_current_user_id();
  v_keep public.lead%ROWTYPE;
  v_other public.lead%ROWTYPE;
BEGIN
  IF NOT public.app_is_staff() OR v_actor IS NULL OR v_actor = '' THEN
    RAISE EXCEPTION 'Only staff can resolve a duplicate.' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('merged', 'not_duplicate') THEN
    RAISE EXCEPTION 'Unknown decision.' USING ERRCODE = '22023';
  END IF;
  IF p_keep = p_other THEN
    RETURN 'not_a_pair';
  END IF;

  -- Lock in id order so two admins resolving the same pair cannot deadlock.
  IF p_keep < p_other THEN
    SELECT * INTO v_keep FROM public.lead WHERE id = p_keep FOR UPDATE;
    SELECT * INTO v_other FROM public.lead WHERE id = p_other FOR UPDATE;
  ELSE
    SELECT * INTO v_other FROM public.lead WHERE id = p_other FOR UPDATE;
    SELECT * INTO v_keep FROM public.lead WHERE id = p_keep FOR UPDATE;
  END IF;
  IF v_keep.id IS NULL OR v_other.id IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF v_keep.anonymised_at IS NOT NULL OR v_other.anonymised_at IS NOT NULL
     OR v_keep.merged_into_id IS NOT NULL OR v_other.merged_into_id IS NOT NULL
     OR v_keep.whatsapp_e164 IS DISTINCT FROM v_other.whatsapp_e164 THEN
    RETURN 'not_a_pair';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_duplicate_decision d
              WHERE (d.lead_a_id = p_keep AND d.lead_b_id = p_other) OR (d.lead_a_id = p_other AND d.lead_b_id = p_keep)) THEN
    RETURN 'already_decided';
  END IF;

  INSERT INTO public.lead_duplicate_decision (id, lead_a_id, lead_b_id, decision, decided_by)
    VALUES (gen_random_uuid(), p_keep, p_other, p_decision, v_actor);

  IF p_decision = 'merged' THEN
    UPDATE public.lead SET merged_into_id = p_keep, last_activity_at = now() WHERE merged_into_id = p_other;
    UPDATE public.lead SET merged_into_id = p_keep, last_activity_at = now() WHERE id = p_other;
    UPDATE public.lead SET last_activity_at = now() WHERE id = p_keep;
    INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data) VALUES
      (gen_random_uuid(), p_keep, 'merged', v_actor, jsonb_build_object('kept', p_keep, 'merged', p_other)),
      (gen_random_uuid(), p_other, 'merged', v_actor, jsonb_build_object('kept', p_keep, 'merged', p_other));
  ELSE
    INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data) VALUES
      (gen_random_uuid(), p_keep, 'duplicate_dismissed', v_actor, jsonb_build_object('other', p_other)),
      (gen_random_uuid(), p_other, 'duplicate_dismissed', v_actor, jsonb_build_object('other', p_keep));
  END IF;

  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_actor, 'leads.resolveDuplicate', 'lead', p_keep::text,
            jsonb_build_object('decision', p_decision, 'other', p_other));
  RETURN CASE WHEN p_decision = 'merged' THEN 'merged' ELSE 'dismissed' END;
END
$$;
--> statement-breakpoint

-- B3 step 11 and B5 step 3 (architecture 7.9, 10.8): erase a person's data. One transaction, so a failure halfway leaves
-- nothing half-erased. It anonymises the lead (and any lead merged into it, which is the same person), overwrites the text of
-- its notes and of a rejected claim's reason, clears event.lead_ref and event.lead_id and the lead link on payment rows. The
-- lead's activity is untouched, and one `anonymised` activity and an audit row are added. Counts, payments and the funnel remain.
-- When a data request is given it must be an open erasure request, and it is marked done in the same transaction.
-- Outcomes: erased, identity_not_confirmed, not_found, already_erased, request_mismatch.
CREATE OR REPLACE FUNCTION public.app_erase_lead(p_lead_id uuid, p_identity_confirmed boolean, p_data_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := public.app_current_user_id();
  v_lead public.lead%ROWTYPE;
  v_request public.data_request%ROWTYPE;
  v_ids uuid[];
  v_refs text[];
BEGIN
  IF NOT public.app_is_staff() OR v_actor IS NULL OR v_actor = '' THEN
    RAISE EXCEPTION 'Only staff can erase a lead.' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(p_identity_confirmed, false) THEN
    RETURN 'identity_not_confirmed';
  END IF;

  SELECT * INTO v_lead FROM public.lead WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_lead.anonymised_at IS NOT NULL THEN
    RETURN 'already_erased';
  END IF;

  IF p_data_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.data_request WHERE id = p_data_request_id FOR UPDATE;
    -- A request logged by an admin names its lead. A portal request names the account, and the lead must be one of its own.
    IF NOT FOUND OR v_request.kind <> 'erasure' OR v_request.status <> 'open'
       OR (v_request.lead_id IS NOT NULL AND v_request.lead_id <> p_lead_id)
       OR (v_request.lead_id IS NULL AND (v_request.user_id IS NULL OR v_lead.user_id IS DISTINCT FROM v_request.user_id)) THEN
      RETURN 'request_mismatch';
    END IF;
  END IF;

  -- The lead and every live lead merged into it.
  SELECT array_agg(l.id), array_agg(l.ref) || array_agg(l.client_ref)
    INTO v_ids, v_refs
    FROM public.lead l
   WHERE (l.id = p_lead_id OR l.merged_into_id = p_lead_id) AND l.anonymised_at IS NULL;

  UPDATE public.lead
     SET name = NULL, whatsapp_e164 = NULL, email = NULL, results = '[]'::jsonb, user_id = NULL,
         anonymised_at = now(), last_activity_at = now()
   WHERE id = ANY (v_ids);
  UPDATE public.lead_note SET body = '[erased]', erased_at = now() WHERE lead_id = ANY (v_ids) AND erased_at IS NULL;
  UPDATE public.lead_claim SET reject_reason = NULL WHERE lead_id = ANY (v_ids) AND reject_reason IS NOT NULL;
  UPDATE public.event SET lead_ref = NULL, lead_id = NULL WHERE lead_id = ANY (v_ids) OR lead_ref = ANY (v_refs);
  UPDATE public.placement_payment SET lead_id = NULL WHERE lead_id = ANY (v_ids);

  INSERT INTO public.lead_activity (id, lead_id, type, actor_id, data)
    SELECT gen_random_uuid(), id, 'anonymised', v_actor,
           CASE WHEN p_data_request_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('data_request_id', p_data_request_id) END
      FROM unnest(v_ids) AS id;

  -- A portal request covers every lead of the account, so it is done only when none is left to erase.
  IF p_data_request_id IS NOT NULL
     AND (v_request.lead_id IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM public.lead l WHERE l.user_id = v_request.user_id AND l.anonymised_at IS NULL)) THEN
    UPDATE public.data_request
       SET status = 'done', handled_by = v_actor, completed_at = now()
     WHERE id = p_data_request_id;
  END IF;

  INSERT INTO public.audit_log (id, actor_id, action, entity_type, entity_id, meta)
    VALUES (gen_random_uuid(), v_actor, 'leads.eraseLead', 'lead', p_lead_id::text,
            jsonb_build_object('leads_erased', coalesce(array_length(v_ids, 1), 0), 'data_request_id', p_data_request_id));
  RETURN 'erased';
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_decide_claim(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_list_claims() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_resolve_duplicate(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_erase_lead(uuid, boolean, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  public.app_decide_claim(uuid, text, text, text),
  public.app_list_claims(),
  public.app_resolve_duplicate(uuid, uuid, text),
  public.app_erase_lead(uuid, boolean, uuid)
TO app_runtime;
