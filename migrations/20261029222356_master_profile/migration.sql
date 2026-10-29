CREATE TABLE "profile_achievement" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_id" text,
	"text" text NOT NULL,
	"metrics" jsonb DEFAULT '[]' NOT NULL,
	"skills" jsonb DEFAULT '[]' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"variants" jsonb DEFAULT '[]' NOT NULL,
	"core" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_entry" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"start_date" text,
	"end_date" text,
	"summary" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_skill" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"level" integer,
	"years" real,
	"aliases" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "profile_achievement_user_id_entry_id_sort_order_index" ON "profile_achievement" ("user_id","entry_id","sort_order");--> statement-breakpoint
CREATE INDEX "profile_entry_user_id_kind_sort_order_index" ON "profile_entry" ("user_id","kind","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_skill_user_name_idx" ON "profile_skill" ("user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "profile_achievement" ADD CONSTRAINT "profile_achievement_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile_achievement" ADD CONSTRAINT "profile_achievement_entry_id_profile_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "profile_entry"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile_entry" ADD CONSTRAINT "profile_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile_skill" ADD CONSTRAINT "profile_skill_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;