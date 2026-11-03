CREATE TABLE "resume_feedback" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"assembly_id" text,
	"rating" text,
	"note" text DEFAULT '' NOT NULL,
	"corrections" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "resume_feedback_user_id_created_at_index" ON "resume_feedback" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "resume_feedback" ADD CONSTRAINT "resume_feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_feedback" ADD CONSTRAINT "resume_feedback_application_id_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resume_feedback" ADD CONSTRAINT "resume_feedback_assembly_id_profile_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "profile_assembly"("id") ON DELETE SET NULL;