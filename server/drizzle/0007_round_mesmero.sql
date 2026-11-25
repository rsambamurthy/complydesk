ALTER TABLE "clients" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "form_data" jsonb DEFAULT '{}'::jsonb NOT NULL;