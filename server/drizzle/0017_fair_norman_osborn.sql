CREATE TABLE "subscription_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan" text NOT NULL,
	"kind" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"amount" numeric NOT NULL,
	"cgst" numeric DEFAULT '0' NOT NULL,
	"sgst" numeric DEFAULT '0' NOT NULL,
	"igst" numeric DEFAULT '0' NOT NULL,
	"total" numeric NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"order_id" text,
	"payment_id" text,
	"reference" text,
	"invoice_no" text,
	"invoice_date" date,
	"buyer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "plans" jsonb;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "seller" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_state" text;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_payments_tenant_ix" ON "subscription_payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_payments_order_uq" ON "subscription_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_payments_invoice_uq" ON "subscription_payments" USING btree ("invoice_no");