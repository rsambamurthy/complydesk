CREATE TABLE "meeting_attendance" (
	"meeting_id" text NOT NULL,
	"person_id" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "meeting_attendance_meeting_id_person_id_pk" PRIMARY KEY("meeting_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_items" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"seq" integer NOT NULL,
	"template_key" text,
	"title" text NOT NULL,
	"resolution_type" text DEFAULT 'NONE' NOT NULL,
	"text" text,
	"person_id" text,
	"filings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text DEFAULT 'PENDING' NOT NULL,
	"created_obligation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"type" text NOT NULL,
	"fy" integer NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"time" text,
	"mode" text DEFAULT 'PHYSICAL' NOT NULL,
	"venue" text,
	"video_link" text,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"notice_sent_on" date,
	"shorter_notice" boolean DEFAULT false NOT NULL,
	"held_on" date,
	"chairperson_id" text,
	"members_present" integer,
	"minutes" text,
	"minutes_signed_on" date,
	"obligation_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_chairperson_id_people_id_fk" FOREIGN KEY ("chairperson_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_client_ix" ON "meetings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "meetings_tenant_date_ix" ON "meetings" USING btree ("tenant_id","date");