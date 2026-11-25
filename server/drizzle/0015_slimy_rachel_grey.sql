CREATE TABLE "doc_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"items" jsonb NOT NULL,
	"note" text,
	"due_date" date,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"sent_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_by" text,
	"last_reminded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"channel" text DEFAULT 'WHATSAPP' NOT NULL,
	"to" text NOT NULL,
	"template" text NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"ref" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whatsapp_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doc_requests" ADD CONSTRAINT "doc_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_requests" ADD CONSTRAINT "doc_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_requests" ADD CONSTRAINT "doc_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_requests_client_ix" ON "doc_requests" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "message_log_tenant_ix" ON "message_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "message_log_ref_ix" ON "message_log" USING btree ("ref");