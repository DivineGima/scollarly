-- S13.5 (architecture 21.8, ADR-045): the student's notifications, derived from rows the student may not read directly. A student cannot read
-- `lead_activity` (staff only, migration 0003), so this SECURITY DEFINER function returns the caller's own items and nothing else: the caller is
-- read from the row level security context, never from an argument. Additive: one new function; no table or column changes (programme.published_at
-- already exists and is filled when an admin publishes).
--
-- Items (kind): stage_changed (the new stage code in `detail`), reply_logged (an adviser replied), new_match (a published programme in one of the
-- caller's chosen course fields, published after they onboarded; `ref` is the university slug and `detail` its name). At most 50, newest first, from
-- the last 30 days. It returns codes, names of public universities and times: no note text, no staff name, no number.
CREATE OR REPLACE FUNCTION public.app_my_notifications()
RETURNS TABLE (kind text, at timestamptz, ref text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user text := public.app_current_user_id();
BEGIN
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.kind, n.at, n.ref, n.detail FROM (
    SELECT 'stage_changed'::text AS kind, a.created_at AS at, l.ref AS ref, a.data ->> 'to' AS detail
      FROM public.lead_activity a JOIN public.lead l ON l.id = a.lead_id
     WHERE l.user_id = v_user AND a.type = 'stage_changed' AND a.created_at > now() - interval '30 days'
    UNION ALL
    SELECT 'reply_logged'::text, a.created_at, l.ref, NULL::text
      FROM public.lead_activity a JOIN public.lead l ON l.id = a.lead_id
     WHERE l.user_id = v_user AND a.type = 'reply_logged' AND a.created_at > now() - interval '30 days'
    UNION ALL
    SELECT 'new_match'::text, m.at, m.slug, m.name FROM (
      SELECT u.slug, u.name, max(coalesce(p.published_at, p.created_at)) AS at
        FROM public.student_profile sp
        JOIN public.programme p ON p.field = ANY (sp.course_fields) AND p.status = 'published'
        JOIN public.university u ON u.id = p.university_id AND u.status = 'published'
       WHERE sp.user_id = v_user
         AND coalesce(p.published_at, p.created_at) > greatest(sp.onboarded_at, now() - interval '30 days')
       GROUP BY u.id, u.slug, u.name
    ) m
  ) n
  ORDER BY n.at DESC
  LIMIT 50;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_my_notifications() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_my_notifications() TO app_runtime;
