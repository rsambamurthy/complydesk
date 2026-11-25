CREATE TABLE "reg_reviews" (
	"tenant_id" text NOT NULL,
	"update_id" text NOT NULL,
	"user_id" text,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reg_reviews_tenant_id_update_id_pk" PRIMARY KEY("tenant_id","update_id")
);
--> statement-breakpoint
CREATE TABLE "reg_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"url" text,
	"issued_on" date,
	"effective_from" date,
	"summary" text NOT NULL,
	"actions" text,
	"applies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"forms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impact" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reg_reviews" ADD CONSTRAINT "reg_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reg_reviews" ADD CONSTRAINT "reg_reviews_update_id_reg_updates_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."reg_updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reg_reviews" ADD CONSTRAINT "reg_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reg_updates_status_ix" ON "reg_updates" USING btree ("status","published_at");