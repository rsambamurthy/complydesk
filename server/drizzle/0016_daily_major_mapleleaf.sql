CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"obligation_id" text,
	"date" date NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_tenant_ix" ON "time_entries" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "time_entries_client_ix" ON "time_entries" USING btree ("client_id");--> statement-breakpoint
-- Existing workspaces: Firm Admins and Partners can see the team's workload.
UPDATE "roles" SET "permissions" = "permissions" || '["team.view"]'::jsonb WHERE "key" IN ('ADMIN','PARTNER') AND NOT ("permissions" ? 'team.view');
