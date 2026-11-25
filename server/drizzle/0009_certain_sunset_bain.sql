CREATE TABLE "help_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"page" text,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"covered" boolean DEFAULT true NOT NULL,
	"helpful" boolean,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "help_questions" ADD CONSTRAINT "help_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_questions" ADD CONSTRAINT "help_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "help_questions_tenant_ix" ON "help_questions" USING btree ("tenant_id","created_at");