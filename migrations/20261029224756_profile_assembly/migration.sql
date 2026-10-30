CREATE TABLE "profile_assembly" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"resume_id" text,
	"mode" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "profile_assembly_user_id_application_id_created_at_index" ON "profile_assembly" ("user_id","application_id","created_at");--> statement-breakpoint
ALTER TABLE "profile_assembly" ADD CONSTRAINT "profile_assembly_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile_assembly" ADD CONSTRAINT "profile_assembly_application_id_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile_assembly" ADD CONSTRAINT "profile_assembly_resume_id_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE SET NULL;