CREATE TABLE "register_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"register" text NOT NULL,
	"entry_date" date NOT NULL,
	"data" jsonb NOT NULL,
	"closed_on" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "father_name" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "membership_no" text;--> statement-breakpoint
ALTER TABLE "shareholders" ADD COLUMN "father_name" text;--> statement-breakpoint
ALTER TABLE "shareholders" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "shareholders" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "shareholders" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "shareholders" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "shareholders" ADD COLUMN "became_member_on" date;--> statement-breakpoint
ALTER TABLE "shareholders" ADD COLUMN "ceased_on" date;--> statement-breakpoint
ALTER TABLE "register_entries" ADD CONSTRAINT "register_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_entries" ADD CONSTRAINT "register_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_entries" ADD CONSTRAINT "register_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "register_entries_client_ix" ON "register_entries" USING btree ("client_id","register","entry_date");