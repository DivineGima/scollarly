CREATE TABLE "page_image" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_image_key_unique" UNIQUE("key"),
	CONSTRAINT "page_image_key_format" CHECK ("page_image"."key" ~ '^[a-z0-9]+(\.[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "page_image" ADD CONSTRAINT "page_image_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- page_image: a named slot (home.hero, about.photo, ...) pointing at a media_asset. Decorative content, public read,
-- staff write, same shape as media_asset itself (architecture 6.5 / this stage's addition).
ALTER TABLE public.page_image ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.page_image FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.page_image TO app_runtime;
--> statement-breakpoint
CREATE POLICY page_image_read ON public.page_image FOR SELECT TO app_runtime USING (true);
--> statement-breakpoint
CREATE POLICY page_image_insert ON public.page_image FOR INSERT TO app_runtime WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY page_image_update ON public.page_image FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());