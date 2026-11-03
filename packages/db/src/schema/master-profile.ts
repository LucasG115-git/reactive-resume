import type { ProfileAssemblyResult, ProfileEntryKind, ProfileMetric } from "@reactive-resume/schema/master-profile";
import type { JobAnalysis, ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import type { ResumeStyleGuide } from "@reactive-resume/schema/resume-style";
import type { ResumeCorrection } from "@reactive-resume/schema/resume-writing";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { application } from "./applications";
import { user } from "./auth";
import { resume } from "./resume";

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

/** One "assemble from posting" run: which profile records became which resume lines, and requirement coverage. */
export const profileAssembly = pg.pgTable(
	"profile_assembly",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		applicationId: pg
			.text("application_id")
			.notNull()
			.references(() => application.id, { onDelete: "cascade" }),
		resumeId: pg.text("resume_id").references(() => resume.id, { onDelete: "set null" }),
		mode: pg.text("mode").notNull().$type<"rephrase" | "verbatim">(),
		/** Provider and model that chose the evidence, for later comparison. */
		model: pg.text("model").notNull().default(""),
		result: pg.jsonb("result").notNull().$type<ProfileAssemblyResult>(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.userId, t.applicationId, t.createdAt)],
);

/**
 * One application's Resume Selection Plan: the posting analysed into ranked requirements, the AI's proposal, and
 * the user's reviewed version that resumes are built from. One per application; re-proposing replaces it.
 */
export const resumeSelection = pg.pgTable(
	"resume_selection",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		applicationId: pg
			.text("application_id")
			.notNull()
			.references(() => application.id, { onDelete: "cascade" }),
		/** The posting text that was analysed, kept even if the application's posting is edited later. */
		postingText: pg.text("posting_text").notNull().default(""),
		analysis: pg.jsonb("analysis").notNull().$type<JobAnalysis>(),
		/** What the ranking and AI proposed, kept so the user's edits can be compared and undone. */
		proposed: pg.jsonb("proposed").notNull().$type<ResumeSelectionPlan>(),
		/** The reviewed plan resumes are built from. */
		plan: pg.jsonb("plan").notNull().$type<ResumeSelectionPlan>(),
		/** Provider and model that analysed and reviewed, for later comparison. */
		model: pg.text("model").notNull().default(""),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [pg.uniqueIndex().on(t.userId, t.applicationId)],
);

/** The user's Resume Style Guide: writing presets and example resumes. One per user; style only, never evidence. */
export const resumeStyleGuide = pg.pgTable("resume_style_guide", {
	userId: pg
		.text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	data: pg.jsonb("data").notNull().$type<ResumeStyleGuide>(),
	updatedAt: pg
		.timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

/**
 * The user's feedback on a generated resume: a rating, a note, and the lines they changed. Informs the writer's
 * style for later resumes; facts always come from the master profile, which feedback never changes.
 */
export const resumeFeedback = pg.pgTable(
	"resume_feedback",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		applicationId: pg
			.text("application_id")
			.notNull()
			.references(() => application.id, { onDelete: "cascade" }),
		assemblyId: pg.text("assembly_id").references(() => profileAssembly.id, { onDelete: "set null" }),
		rating: pg.text("rating").$type<"good" | "needs-work">(),
		note: pg.text("note").notNull().default(""),
		corrections: pg.jsonb("corrections").notNull().$type<ResumeCorrection[]>().default([]),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.userId, t.createdAt)],
);
