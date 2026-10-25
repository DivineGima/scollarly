-- Stage 0 scaffolding is no longer referenced by any code (the probe routes, the stub lead intake and the published-content page were removed in the same change).
-- Contract step of an expand/contract pair: nothing reads these any more, and they held only throwaway measurement rows.
DROP FUNCTION IF EXISTS public.app_create_phase0_lead(uuid, uuid, text, text, text, text);--> statement-breakpoint
DROP TABLE "phase0_content" CASCADE;--> statement-breakpoint
DROP TABLE "phase0_lead_stub" CASCADE;