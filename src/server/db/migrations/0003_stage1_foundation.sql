CREATE TABLE "admin_invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_invite_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "admin_invite_expiry_check" CHECK ("admin_invite"."expires_at" > "admin_invite"."created_at")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campus_experience" (
	"id" uuid PRIMARY KEY NOT NULL,
	"university_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"youtube_id" text,
	"url" text,
	"thumbnail_media_id" uuid,
	"url_last_checked_at" timestamp with time zone,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campus_experience_status_check" CHECK ("campus_experience"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "campus_experience_kind_check" CHECK ("campus_experience"."kind" in ('video', 'tour360', 'gallery')),
	CONSTRAINT "campus_experience_youtube_id_format" CHECK ("campus_experience"."youtube_id" is null or "campus_experience"."youtube_id" ~ '^[a-zA-Z0-9_-]{11}$'),
	CONSTRAINT "campus_experience_translations_object" CHECK (jsonb_typeof("campus_experience"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_name" text NOT NULL,
	"scope" text NOT NULL,
	"evidence_note" text,
	"granted_at" timestamp with time zone NOT NULL,
	"recorded_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "consent_record_scope_check" CHECK ("consent_record"."scope" in ('testimonial', 'journey', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "content_block" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_block_key_unique" UNIQUE("key"),
	CONSTRAINT "content_block_status_check" CHECK ("content_block"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "content_block_translations_object" CHECK (jsonb_typeof("content_block"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "data_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"lead_id" uuid,
	"channel" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"handled_by" text,
	"completed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_request_kind_check" CHECK ("data_request"."kind" in ('export', 'erasure')),
	CONSTRAINT "data_request_channel_check" CHECK ("data_request"."channel" in ('portal', 'whatsapp', 'other')),
	CONSTRAINT "data_request_status_check" CHECK ("data_request"."status" in ('open', 'done', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"session_id" text,
	"lead_ref" text,
	"lead_id" uuid,
	"university_id" uuid,
	"page_group" text,
	"country" text,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type_check" CHECK ("event"."type" in ('page_view', 'wa_tap', 'form_start', 'form_submit', 'install'))
);
--> statement-breakpoint
CREATE TABLE "event_daily_agg" (
	"date" date NOT NULL,
	"type" text NOT NULL,
	"country" text,
	"university_id" uuid,
	"page_group" text,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_daily_agg_key" UNIQUE NULLS NOT DISTINCT("date","type","country","university_id","page_group"),
	CONSTRAINT "event_daily_agg_type_check" CHECK ("event_daily_agg"."type" in ('page_view', 'wa_tap', 'form_start', 'form_submit', 'install')),
	CONSTRAINT "event_daily_agg_count_check" CHECK ("event_daily_agg"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "faq" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category" text,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faq_status_check" CHECK ("faq"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "faq_translations_object" CHECK (jsonb_typeof("faq"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "fee_structure" (
	"id" uuid PRIMARY KEY NOT NULL,
	"university_id" uuid NOT NULL,
	"programme_id" uuid,
	"currency" text NOT NULL,
	"amount_min" numeric(12, 2),
	"amount_max" numeric(12, 2),
	"period" text NOT NULL,
	"data_confirmed" boolean DEFAULT false NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_structure_status_check" CHECK ("fee_structure"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "fee_structure_currency_check" CHECK ("fee_structure"."currency" in ('USD', 'INR')),
	CONSTRAINT "fee_structure_confirmed_range" CHECK (not "fee_structure"."data_confirmed" or ("fee_structure"."amount_min" is not null and "fee_structure"."amount_max" is not null and "fee_structure"."amount_min" > 0 and "fee_structure"."amount_max" >= "fee_structure"."amount_min")),
	CONSTRAINT "fee_structure_translations_object" CHECK (jsonb_typeof("fee_structure"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "journey" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_name" text NOT NULL,
	"country" text,
	"university_id" uuid,
	"summary" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"consent_id" uuid,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_status_check" CHECK ("journey"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "journey_publish_gate" CHECK ("journey"."status" <> 'published' or ("journey"."verified" and "journey"."consent_id" is not null)),
	CONSTRAINT "journey_translations_object" CHECK (jsonb_typeof("journey"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "journey_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"journey_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"date_label" text,
	CONSTRAINT "journey_step_position" UNIQUE("journey_id","position"),
	CONSTRAINT "journey_step_position_positive" CHECK ("journey_step"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"client_ref" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"name" text,
	"whatsapp_e164" text,
	"country_code" text NOT NULL,
	"email" text,
	"intake_kind" text DEFAULT 'full' NOT NULL,
	"qualification_type" text,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"stage_code" text DEFAULT 'share_results' NOT NULL,
	"assigned_admin_id" text,
	"user_id" text,
	"consent_notice_version" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"client_created_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"sla_hours_applied" integer NOT NULL,
	"first_response_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_into_id" uuid,
	"anonymised_at" timestamp with time zone,
	CONSTRAINT "lead_ref_unique" UNIQUE("ref"),
	CONSTRAINT "lead_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "lead_ref_format" CHECK ("lead"."ref" ~ '^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'),
	CONSTRAINT "lead_client_ref_format" CHECK ("lead"."client_ref" ~ '^SC-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'),
	CONSTRAINT "lead_payload_hash_format" CHECK ("lead"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "lead_country_code_format" CHECK ("lead"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "lead_intake_kind_check" CHECK ("lead"."intake_kind" in ('full', 'quick')),
	CONSTRAINT "lead_qualification_type_check" CHECK ("lead"."qualification_type" is null or "lead"."qualification_type" in ('olevel_alevel', 'grade10_11')),
	CONSTRAINT "lead_qualification_required_for_full" CHECK ("lead"."intake_kind" = 'quick' or "lead"."qualification_type" is not null),
	CONSTRAINT "lead_results_is_array" CHECK (jsonb_typeof("lead"."results") = 'array'),
	CONSTRAINT "lead_quick_has_no_results" CHECK ("lead"."intake_kind" = 'full' or "lead"."results" = '[]'::jsonb),
	CONSTRAINT "lead_source_is_object" CHECK (jsonb_typeof("lead"."source") = 'object'),
	CONSTRAINT "lead_sla_hours_positive" CHECK ("lead"."sla_hours_applied" > 0),
	CONSTRAINT "lead_not_merged_into_itself" CHECK ("lead"."merged_into_id" is null or "lead"."merged_into_id" <> "lead"."id"),
	CONSTRAINT "lead_identity_or_anonymised" CHECK (("lead"."anonymised_at" is null and "lead"."name" is not null and btrim("lead"."name") <> '' and "lead"."whatsapp_e164" is not null and "lead"."whatsapp_e164" ~ '^[+][1-9][0-9]{6,14}$')
        or ("lead"."anonymised_at" is not null and "lead"."name" is null and "lead"."whatsapp_e164" is null and "lead"."email" is null and "lead"."results" = '[]'::jsonb))
);
--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_activity_type_check" CHECK ("lead_activity"."type" in ('created', 'note', 'stage_changed', 'reply_logged', 'assigned', 'admin_wa_opened', 'claimed', 'merged', 'duplicate_dismissed', 'anonymised')),
	CONSTRAINT "lead_activity_data_is_object" CHECK (jsonb_typeof("lead_activity"."data") = 'object')
);
--> statement-breakpoint
CREATE TABLE "lead_claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_method" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_claim_method_check" CHECK ("lead_claim"."method" in ('auto', 'ref', 'number')),
	CONSTRAINT "lead_claim_status_check" CHECK ("lead_claim"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "lead_claim_verification_check" CHECK ("lead_claim"."verification_method" is null or "lead_claim"."verification_method" in ('email_match', 'whatsapp_confirmed')),
	CONSTRAINT "lead_claim_approval_needs_method" CHECK ("lead_claim"."status" <> 'approved' or "lead_claim"."verification_method" is not null)
);
--> statement-breakpoint
CREATE TABLE "lead_duplicate_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_a_id" uuid NOT NULL,
	"lead_b_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_duplicate_decision_check" CHECK ("lead_duplicate_decision"."decision" in ('merged', 'not_duplicate')),
	CONSTRAINT "lead_duplicate_distinct" CHECK ("lead_duplicate_decision"."lead_a_id" <> "lead_duplicate_decision"."lead_b_id")
);
--> statement-breakpoint
CREATE TABLE "lead_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erased_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_programme_pref" (
	"lead_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "lead_programme_pref_lead_id_programme_id_pk" PRIMARY KEY("lead_id","programme_id"),
	CONSTRAINT "lead_programme_pref_rank" UNIQUE("lead_id","rank"),
	CONSTRAINT "lead_programme_pref_rank_positive" CHECK ("lead_programme_pref"."rank" >= 1)
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stage_code" text NOT NULL,
	"locale" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_template_status_check" CHECK ("message_template"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "official_resource" (
	"id" uuid PRIMARY KEY NOT NULL,
	"university_id" uuid,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"kind" text,
	"url_last_checked_at" timestamp with time zone,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_resource_status_check" CHECK ("official_resource"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "official_resource_translations_object" CHECK (jsonb_typeof("official_resource"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"code" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"name" jsonb NOT NULL,
	CONSTRAINT "pipeline_stage_position_unique" UNIQUE("position"),
	CONSTRAINT "pipeline_stage_name_object" CHECK (jsonb_typeof("pipeline_stage"."name") = 'object')
);
--> statement-breakpoint
CREATE TABLE "placement_payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_token" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"lead_id" uuid,
	"amount_usd_cents" bigint NOT NULL,
	"received_on" date NOT NULL,
	"note" text,
	"entered_by" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "placement_payment_submission_token_unique" UNIQUE("submission_token"),
	CONSTRAINT "placement_payment_amount_positive" CHECK ("placement_payment"."amount_usd_cents" > 0),
	CONSTRAINT "placement_payment_void_consistency" CHECK (("placement_payment"."voided_at" is null and "placement_payment"."voided_by" is null and "placement_payment"."void_reason" is null)
        or ("placement_payment"."voided_at" is not null and "placement_payment"."voided_by" is not null and "placement_payment"."void_reason" is not null and btrim("placement_payment"."void_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "post" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"cover_media_id" uuid,
	"author_id" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_slug_unique" UNIQUE("slug"),
	CONSTRAINT "post_status_check" CHECK ("post"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "post_slug_format" CHECK ("post"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "post_translations_object" CHECK (jsonb_typeof("post"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "process_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_step_status_check" CHECK ("process_step"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "process_step_kind_check" CHECK ("process_step"."kind" in ('application', 'visa')),
	CONSTRAINT "process_step_position_positive" CHECK ("process_step"."position" >= 1),
	CONSTRAINT "process_step_translations_object" CHECK (jsonb_typeof("process_step"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "programme" (
	"id" uuid PRIMARY KEY NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"field" text,
	"duration_months" integer,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programme_status_check" CHECK ("programme"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "programme_duration_positive" CHECK ("programme"."duration_months" is null or "programme"."duration_months" > 0),
	CONSTRAINT "programme_translations_object" CHECK (jsonb_typeof("programme"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "site_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role_title" text NOT NULL,
	"bio" text,
	"photo_media_id" uuid,
	"confirmed" boolean DEFAULT false NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_status_check" CHECK ("team_member"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "team_member_publish_gate" CHECK ("team_member"."status" <> 'published' or "team_member"."confirmed"),
	CONSTRAINT "team_member_translations_object" CHECK (jsonb_typeof("team_member"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "testimonial" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_name" text NOT NULL,
	"country" text,
	"university_id" uuid,
	"quote" text NOT NULL,
	"photo_media_id" uuid,
	"verified" boolean DEFAULT false NOT NULL,
	"consent_id" uuid,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "testimonial_status_check" CHECK ("testimonial"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "testimonial_publish_gate" CHECK ("testimonial"."status" <> 'published' or ("testimonial"."verified" and "testimonial"."consent_id" is not null)),
	CONSTRAINT "testimonial_translations_object" CHECK (jsonb_typeof("testimonial"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "trust_stat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"as_of" date,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_stat_key_unique" UNIQUE("key"),
	CONSTRAINT "trust_stat_status_check" CHECK ("trust_stat"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "trust_stat_publish_gate" CHECK ("trust_stat"."status" <> 'published' or "trust_stat"."confirmed"),
	CONSTRAINT "trust_stat_translations_object" CHECK (jsonb_typeof("trust_stat"."translations") = 'object')
);
--> statement-breakpoint
CREATE TABLE "university" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"state" text,
	"type" text,
	"naac_grade" text,
	"website_url" text,
	"logo_media_id" uuid,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "university_slug_unique" UNIQUE("slug"),
	CONSTRAINT "university_status_check" CHECK ("university"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "university_slug_format" CHECK ("university"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "university_translations_object" CHECK (jsonb_typeof("university"."translations") = 'object')
);
--> statement-breakpoint
ALTER TABLE "campus_experience" ADD CONSTRAINT "campus_experience_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_experience" ADD CONSTRAINT "campus_experience_thumbnail_media_id_media_asset_id_fk" FOREIGN KEY ("thumbnail_media_id") REFERENCES "public"."media_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_daily_agg" ADD CONSTRAINT "event_daily_agg_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure" ADD CONSTRAINT "fee_structure_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure" ADD CONSTRAINT "fee_structure_programme_id_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey" ADD CONSTRAINT "journey_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey" ADD CONSTRAINT "journey_consent_id_consent_record_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consent_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_step" ADD CONSTRAINT "journey_step_journey_id_journey_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journey"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_stage_code_pipeline_stage_code_fk" FOREIGN KEY ("stage_code") REFERENCES "public"."pipeline_stage"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_admin_id_app_user_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_merged_into_id_lead_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_claim" ADD CONSTRAINT "lead_claim_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_claim" ADD CONSTRAINT "lead_claim_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_duplicate_decision" ADD CONSTRAINT "lead_duplicate_decision_lead_a_id_lead_id_fk" FOREIGN KEY ("lead_a_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_duplicate_decision" ADD CONSTRAINT "lead_duplicate_decision_lead_b_id_lead_id_fk" FOREIGN KEY ("lead_b_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_note" ADD CONSTRAINT "lead_note_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_programme_pref" ADD CONSTRAINT "lead_programme_pref_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_programme_pref" ADD CONSTRAINT "lead_programme_pref_programme_id_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_stage_code_pipeline_stage_code_fk" FOREIGN KEY ("stage_code") REFERENCES "public"."pipeline_stage"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_resource" ADD CONSTRAINT "official_resource_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_payment" ADD CONSTRAINT "placement_payment_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_payment" ADD CONSTRAINT "placement_payment_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_cover_media_id_media_asset_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme" ADD CONSTRAINT "programme_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_photo_media_id_media_asset_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial" ADD CONSTRAINT "testimonial_university_id_university_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."university"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial" ADD CONSTRAINT "testimonial_photo_media_id_media_asset_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonial" ADD CONSTRAINT "testimonial_consent_id_consent_record_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consent_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university" ADD CONSTRAINT "university_logo_media_id_media_asset_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campus_experience_status_sort_idx" ON "campus_experience" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "campus_experience_university_idx" ON "campus_experience" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "event_received_at_idx" ON "event" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "event_lead_ref_idx" ON "event" USING btree ("lead_ref");--> statement-breakpoint
CREATE INDEX "faq_status_sort_idx" ON "faq" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "fee_structure_status_sort_idx" ON "fee_structure" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "fee_structure_university_idx" ON "fee_structure" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "journey_status_sort_idx" ON "journey" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "lead_client_ref_idx" ON "lead" USING btree ("client_ref");--> statement-breakpoint
CREATE INDEX "lead_whatsapp_e164_idx" ON "lead" USING btree ("whatsapp_e164");--> statement-breakpoint
CREATE INDEX "lead_received_at_idx" ON "lead" USING btree ("received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_stage_assigned_idx" ON "lead" USING btree ("stage_code","assigned_admin_id");--> statement-breakpoint
CREATE INDEX "lead_sla_due_open_idx" ON "lead" USING btree ("sla_due_at") WHERE "lead"."first_response_at" is null;--> statement-breakpoint
CREATE INDEX "lead_user_id_idx" ON "lead" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lead_activity_lead_created_idx" ON "lead_activity" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_claim_lead_idx" ON "lead_claim" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_claim_user_idx" ON "lead_claim" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_template_stage_idx" ON "message_template" USING btree ("stage_code","locale");--> statement-breakpoint
CREATE INDEX "official_resource_status_sort_idx" ON "official_resource" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "placement_payment_university_received_idx" ON "placement_payment" USING btree ("university_id","received_on");--> statement-breakpoint
CREATE INDEX "post_status_published_idx" ON "post" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "process_step_status_position_idx" ON "process_step" USING btree ("status","kind","position");--> statement-breakpoint
CREATE INDEX "programme_status_sort_idx" ON "programme" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "programme_university_idx" ON "programme" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "team_member_status_sort_idx" ON "team_member" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "testimonial_status_sort_idx" ON "testimonial" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "trust_stat_status_sort_idx" ON "trust_stat" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "university_status_sort_idx" ON "university" USING btree ("status","sort_order");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_owner() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT public.app_current_role() = 'owner' $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_is_owner() TO app_runtime;
--> statement-breakpoint
ALTER TABLE public.university ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.university FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.university TO app_runtime;
--> statement-breakpoint
CREATE POLICY university_read ON public.university FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY university_insert ON public.university FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY university_update ON public.university FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.programme ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.programme FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.programme TO app_runtime;
--> statement-breakpoint
CREATE POLICY programme_read ON public.programme FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY programme_insert ON public.programme FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY programme_update ON public.programme FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.fee_structure ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.fee_structure FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.fee_structure TO app_runtime;
--> statement-breakpoint
CREATE POLICY fee_structure_read ON public.fee_structure FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY fee_structure_insert ON public.fee_structure FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY fee_structure_update ON public.fee_structure FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.campus_experience ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.campus_experience FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.campus_experience TO app_runtime;
--> statement-breakpoint
CREATE POLICY campus_experience_read ON public.campus_experience FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY campus_experience_insert ON public.campus_experience FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY campus_experience_update ON public.campus_experience FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.official_resource ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.official_resource FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.official_resource TO app_runtime;
--> statement-breakpoint
CREATE POLICY official_resource_read ON public.official_resource FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY official_resource_insert ON public.official_resource FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY official_resource_update ON public.official_resource FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.testimonial ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.testimonial FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.testimonial TO app_runtime;
--> statement-breakpoint
CREATE POLICY testimonial_read ON public.testimonial FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY testimonial_insert ON public.testimonial FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY testimonial_update ON public.testimonial FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.journey ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.journey FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.journey TO app_runtime;
--> statement-breakpoint
CREATE POLICY journey_read ON public.journey FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY journey_insert ON public.journey FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY journey_update ON public.journey FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.team_member ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.team_member FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.team_member TO app_runtime;
--> statement-breakpoint
CREATE POLICY team_member_read ON public.team_member FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY team_member_insert ON public.team_member FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY team_member_update ON public.team_member FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.faq ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.faq FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.faq TO app_runtime;
--> statement-breakpoint
CREATE POLICY faq_read ON public.faq FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY faq_insert ON public.faq FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY faq_update ON public.faq FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.trust_stat ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trust_stat FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.trust_stat TO app_runtime;
--> statement-breakpoint
CREATE POLICY trust_stat_read ON public.trust_stat FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY trust_stat_insert ON public.trust_stat FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY trust_stat_update ON public.trust_stat FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.post ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.post FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.post TO app_runtime;
--> statement-breakpoint
CREATE POLICY post_read ON public.post FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY post_insert ON public.post FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY post_update ON public.post FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.process_step ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.process_step FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.process_step TO app_runtime;
--> statement-breakpoint
CREATE POLICY process_step_read ON public.process_step FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY process_step_insert ON public.process_step FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY process_step_update ON public.process_step FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.content_block ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.content_block FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.content_block TO app_runtime;
--> statement-breakpoint
CREATE POLICY content_block_read ON public.content_block FOR SELECT TO app_runtime
  USING (status = 'published' OR public.app_is_staff());
--> statement-breakpoint
CREATE POLICY content_block_insert ON public.content_block FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY content_block_update ON public.content_block FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.journey_step ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.journey_step FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.journey_step TO app_runtime;
--> statement-breakpoint
CREATE POLICY journey_step_read ON public.journey_step FOR SELECT TO app_runtime
  USING (public.app_is_staff() OR EXISTS (SELECT 1 FROM public.journey j WHERE j.id = journey_id AND j.status = 'published'));
--> statement-breakpoint
CREATE POLICY journey_step_insert ON public.journey_step FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY journey_step_update ON public.journey_step FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.consent_record ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.consent_record FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.consent_record TO app_runtime;
--> statement-breakpoint
CREATE POLICY consent_record_read ON public.consent_record FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY consent_record_insert ON public.consent_record FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY consent_record_update ON public.consent_record FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.message_template ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.message_template FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.message_template TO app_runtime;
--> statement-breakpoint
CREATE POLICY message_template_read ON public.message_template FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY message_template_insert ON public.message_template FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY message_template_update ON public.message_template FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.site_setting ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.site_setting FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.site_setting TO app_runtime;
--> statement-breakpoint
CREATE POLICY site_setting_read ON public.site_setting FOR SELECT TO app_runtime
  USING (true);
--> statement-breakpoint
CREATE POLICY site_setting_insert ON public.site_setting FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_owner());
--> statement-breakpoint
CREATE POLICY site_setting_update ON public.site_setting FOR UPDATE TO app_runtime
  USING (public.app_is_owner()) WITH CHECK (public.app_is_owner());
--> statement-breakpoint
ALTER TABLE public.pipeline_stage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pipeline_stage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON public.pipeline_stage TO app_runtime;
--> statement-breakpoint
CREATE POLICY pipeline_stage_read ON public.pipeline_stage FOR SELECT TO app_runtime
  USING (true);
--> statement-breakpoint
ALTER TABLE public.lead ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.lead TO app_runtime;
--> statement-breakpoint
CREATE POLICY lead_read ON public.lead FOR SELECT TO app_runtime
  USING (public.app_is_staff() OR user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY lead_update ON public.lead FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.lead_programme_pref ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_programme_pref FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON public.lead_programme_pref TO app_runtime;
--> statement-breakpoint
CREATE POLICY lead_programme_pref_read ON public.lead_programme_pref FOR SELECT TO app_runtime
  USING (public.app_is_staff() OR EXISTS (SELECT 1 FROM public.lead l WHERE l.id = lead_id AND l.user_id = public.app_current_user_id()));
--> statement-breakpoint
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_activity FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.lead_activity TO app_runtime;
--> statement-breakpoint
CREATE POLICY lead_activity_read ON public.lead_activity FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY lead_activity_insert ON public.lead_activity FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() AND actor_id = public.app_current_user_id());
--> statement-breakpoint
ALTER TABLE public.lead_note ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_note FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.lead_note TO app_runtime;
--> statement-breakpoint
CREATE POLICY lead_note_read ON public.lead_note FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY lead_note_insert ON public.lead_note FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() AND author_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY lead_note_update ON public.lead_note FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.lead_claim ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_claim FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.lead_claim TO app_runtime;
--> statement-breakpoint
CREATE POLICY lead_claim_read ON public.lead_claim FOR SELECT TO app_runtime
  USING (public.app_is_staff() OR user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY lead_claim_insert ON public.lead_claim FOR INSERT TO app_runtime
  WITH CHECK (user_id = public.app_current_user_id() AND status = 'pending' AND method IN ('ref', 'number'));
--> statement-breakpoint
CREATE POLICY lead_claim_update ON public.lead_claim FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.lead_duplicate_decision ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_duplicate_decision FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.lead_duplicate_decision TO app_runtime;
--> statement-breakpoint
CREATE POLICY lead_duplicate_decision_read ON public.lead_duplicate_decision FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY lead_duplicate_decision_insert ON public.lead_duplicate_decision FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() AND decided_by = public.app_current_user_id());
--> statement-breakpoint
ALTER TABLE public.data_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.data_request TO app_runtime;
--> statement-breakpoint
CREATE POLICY data_request_read ON public.data_request FOR SELECT TO app_runtime
  USING (public.app_is_staff() OR user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY data_request_insert ON public.data_request FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() OR (user_id = public.app_current_user_id() AND channel = 'portal'));
--> statement-breakpoint
CREATE POLICY data_request_update ON public.data_request FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.admin_invite ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.admin_invite FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.admin_invite TO app_runtime;
--> statement-breakpoint
CREATE POLICY admin_invite_read ON public.admin_invite FOR SELECT TO app_runtime
  USING (public.app_is_owner());
--> statement-breakpoint
CREATE POLICY admin_invite_insert ON public.admin_invite FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_owner());
--> statement-breakpoint
CREATE POLICY admin_invite_update ON public.admin_invite FOR UPDATE TO app_runtime
  USING (public.app_is_owner()) WITH CHECK (public.app_is_owner());
--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.audit_log TO app_runtime;
--> statement-breakpoint
CREATE POLICY audit_log_read ON public.audit_log FOR SELECT TO app_runtime
  USING (public.app_is_owner());
--> statement-breakpoint
CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT TO app_runtime
  WITH CHECK (actor_id = public.app_current_user_id());
--> statement-breakpoint
ALTER TABLE public.event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON public.event TO app_runtime;
--> statement-breakpoint
CREATE POLICY event_read ON public.event FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.event_daily_agg ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.event_daily_agg FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON public.event_daily_agg TO app_runtime;
--> statement-breakpoint
CREATE POLICY event_daily_agg_read ON public.event_daily_agg FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
ALTER TABLE public.placement_payment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.placement_payment FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.placement_payment TO app_runtime;
--> statement-breakpoint
CREATE POLICY placement_payment_read ON public.placement_payment FOR SELECT TO app_runtime
  USING (public.app_is_staff());
--> statement-breakpoint
CREATE POLICY placement_payment_insert ON public.placement_payment FOR INSERT TO app_runtime
  WITH CHECK (public.app_is_staff() AND entered_by = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY placement_payment_update ON public.placement_payment FOR UPDATE TO app_runtime
  USING (public.app_is_staff()) WITH CHECK (public.app_is_staff());
--> statement-breakpoint
INSERT INTO public.pipeline_stage (code, position, name) VALUES
  ('share_results', 1, '{"en": "Share results"}'::jsonb),
  ('choose_course', 2, '{"en": "Choose course"}'::jsonb),
  ('offer_letter', 3, '{"en": "Offer letter"}'::jsonb),
  ('confirm_admission', 4, '{"en": "Confirm admission"}'::jsonb),
  ('visa', 5, '{"en": "Visa"}'::jsonb),
  ('arrived', 6, '{"en": "Arrived"}'::jsonb)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.site_setting (key, value) VALUES
  ('whatsapp_number_e164', 'null'::jsonb),
  ('contact_phone_display', 'null'::jsonb),
  ('sla_weekday_hours', '4'::jsonb),
  ('sla_weekend_hours', '24'::jsonb),
  ('timezone', '"Africa/Douala"'::jsonb),
  ('media_budget_bytes', '3758096384'::jsonb),
  ('stale_fee_days', '180'::jsonb),
  ('stale_tour_days', '90'::jsonb),
  ('pipeline_freshness_days', 'null'::jsonb),
  ('collect_page_views', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
