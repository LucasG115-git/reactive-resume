import type { ProfileEntryKind, ProfileMetric } from "@reactive-resume/schema/master-profile";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";

const owned = () => ({
	id: pg
		.text("id")
		.primaryKey()
		.$defaultFn(() => generateId()),
	userId: pg
		.text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	sortOrder: pg.integer("sort_order").notNull().default(0),
	hidden: pg.boolean("hidden").notNull().default(false),
	createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: pg
		.timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

const stringList = (name: string) => pg.jsonb(name).notNull().$type<string[]>().default([]);

/** Where the work happened: a position, project, degree, volunteer role, certification or award. */
export const profileEntry = pg.pgTable(
	"profile_entry",
	{
		...owned(),
		kind: pg.text("kind").notNull().$type<ProfileEntryKind>(),
		organization: pg.text("organization").notNull().default(""),
		title: pg.text("title").notNull(),
		location: pg.text("location").notNull().default(""),
		url: pg.text("url").notNull().default(""),
		/** YYYY or YYYY-MM. */
		startDate: pg.text("start_date"),
		endDate: pg.text("end_date"),
		summary: pg.text("summary").notNull().default(""),
		tags: stringList("tags"),
	},
	(t) => [pg.index().on(t.userId, t.kind, t.sortOrder)],
);

/** What was achieved: a resume bullet candidate with its evidence. */
export const profileAchievement = pg.pgTable(
	"profile_achievement",
	{
		...owned(),
		entryId: pg.text("entry_id").references(() => profileEntry.id, { onDelete: "cascade" }),
		text: pg.text("text").notNull(),
		metrics: pg.jsonb("metrics").notNull().$type<ProfileMetric[]>().default([]),
		skills: stringList("skills"),
		tags: stringList("tags"),
		variants: stringList("variants"),
		core: pg.boolean("core").notNull().default(false),
	},
	(t) => [pg.index().on(t.userId, t.entryId, t.sortOrder)],
);

export const profileSkill = pg.pgTable(
	"profile_skill",
	{
		...owned(),
		name: pg.text("name").notNull(),
		category: pg.text("category").notNull().default(""),
		level: pg.integer("level"),
		years: pg.real("years"),
		aliases: stringList("aliases"),
	},
	(t) => [pg.uniqueIndex("profile_skill_user_name_idx").on(t.userId, sql`lower(${t.name})`)],
);
