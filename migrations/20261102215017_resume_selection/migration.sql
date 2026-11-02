CREATE TABLE "resume_selection" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"posting_text" text DEFAULT '' NOT NULL,
	"analysis" jsonb NOT NULL,
	"proposed" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "resume_selection_user_id_application_id_index" ON "resume_selection" ("user_id","application_id");--> statement-breakpoint
ALTER TABLE "resume_selection" ADD CONSTRAINT "resume_selection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_selection" ADD CONSTRAINT "resume_selection_application_id_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE;