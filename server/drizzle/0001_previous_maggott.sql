CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"type" text NOT NULL,
	"by" text,
	"data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"trial_days" integer DEFAULT 30 NOT NULL,
	"trial_client_limit" integer DEFAULT 10,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "icsi_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "contact_mobile" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "source" text DEFAULT 'ADMIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "platform_notes" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;