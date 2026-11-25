CREATE TABLE "filing_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"obligation_id" text NOT NULL,
	"attachment_id" text,
	"file_name" text,
	"findings" jsonb NOT NULL,
	"user_id" text,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filing_checks" ADD CONSTRAINT "filing_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_checks" ADD CONSTRAINT "filing_checks_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_checks" ADD CONSTRAINT "filing_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filing_checks_ob_ix" ON "filing_checks" USING btree ("obligation_id","created_at");