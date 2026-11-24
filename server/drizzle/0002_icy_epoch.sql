CREATE TABLE "rule_history" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"code" text NOT NULL,
	"action" text NOT NULL,
	"by" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "source" text DEFAULT 'CATALOGUE' NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "rule_history" ADD CONSTRAINT "rule_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_history_code_ix" ON "rule_history" USING btree ("code");--> statement-breakpoint
UPDATE "rules" SET "source" = 'WORKSPACE' WHERE "tenant_id" IS NOT NULL;
