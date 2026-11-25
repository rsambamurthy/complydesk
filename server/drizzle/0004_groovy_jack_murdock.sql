CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_id" text,
	"uploaded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"obligation_id" text NOT NULL,
	"action" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"note" text,
	"user_id" text,
	"user_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"tenant_id" text NOT NULL,
	"items" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_log_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "stage" text DEFAULT 'TODO' NOT NULL;--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "prepared_by_id" text;--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "reviewed_by_id" text;--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "client_approved_by_id" text;--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "client_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reminders_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_events" ADD CONSTRAINT "obligation_events_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_events" ADD CONSTRAINT "obligation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_entity_ix" ON "attachments" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "obligation_events_ob_ix" ON "obligation_events" USING btree ("obligation_id");--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_prepared_by_id_users_id_fk" FOREIGN KEY ("prepared_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_client_approved_by_id_users_id_fk" FOREIGN KEY ("client_approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "obligations" SET "stage" = CASE "status" WHEN 'FILED' THEN 'FILED' WHEN 'IN_PROGRESS' THEN 'DATA' WHEN 'NOT_APPLICABLE' THEN 'NA' ELSE 'TODO' END;--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || '["compliance.client_approve"]'::jsonb WHERE "key" = 'CLIENT_ADMIN' AND NOT ("permissions" @> '["compliance.client_approve"]'::jsonb);
