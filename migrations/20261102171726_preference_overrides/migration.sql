CREATE TABLE "career_preference_override" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"key" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "career_preference_override_user_id_application_id_key_index" ON "career_preference_override" ("user_id","application_id","key");--> statement-breakpoint
ALTER TABLE "career_preference_override" ADD CONSTRAINT "career_preference_override_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "career_preference_override" ADD CONSTRAINT "career_preference_override_application_id_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE;