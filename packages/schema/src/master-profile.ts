import z from "zod";

/**
 * Master Profile: a structured, user-verified record of a career (where you worked, what you achieved,
 * which skills you have) that resumes are assembled from. Separate from Career Knowledge facts, which
 * stay free-text coaching evidence.
 */

export const PROFILE_ENTRY_KINDS = ["position", "project", "education", "volunteer", "certification", "award"] as const;
export const profileEntryKindSchema = z.enum(PROFILE_ENTRY_KINDS);
export type ProfileEntryKind = z.infer<typeof profileEntryKindSchema>;

/** `YYYY` or `YYYY-MM`. Partial dates are normal on resumes, so days are never stored. */
export const profileDateSchema = z
	.string()
	.trim()
	.regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Use YYYY or YYYY-MM");

const tagsSchema = z.array(z.string().trim().min(1).max(60)).max(30).default([]);

export const profileEntryInputSchema = z
	.object({
		kind: profileEntryKindSchema,
		organization: z.string().trim().max(200).default(""),
		/** Job title, degree, project name, certification or award name. */
		title: z.string().trim().min(1).max(200),
		location: z.string().trim().max(200).default(""),
		url: z.union([z.url().max(2048), z.literal("")]).default(""),
		startDate: profileDateSchema.nullable().default(null),
		/** Null with a start date means ongoing. */
		endDate: profileDateSchema.nullable().default(null),
		summary: z.string().trim().max(2000).default(""),
		tags: tagsSchema,
		hidden: z.boolean().default(false),
	})
	.refine((entry) => !entry.startDate || !entry.endDate || entry.startDate <= entry.endDate, {
		message: "End date is before start date",
		path: ["endDate"],
	});
export type ProfileEntryInput = z.infer<typeof profileEntryInputSchema>;

export const profileMetricSchema = z.object({
	/** As written, so "1.2M", "40" and "3x" all survive. */
	value: z.string().trim().min(1).max(40),
	unit: z.string().trim().max(40).default(""),
	/** What was measured, e.g. "less admin time per month". */
	label: z.string().trim().max(200).default(""),
});
export type ProfileMetric = z.infer<typeof profileMetricSchema>;

export const profileAchievementInputSchema = z.object({
	/** The entry it belongs to; null for a standalone achievement. */
	entryId: z.string().min(1).nullable().default(null),
	/** The claim, written as a resume bullet. */
	text: z.string().trim().min(1).max(1000),
	metrics: z.array(profileMetricSchema).max(10).default([]),
	/** Skills and tools this achievement demonstrates. */
	skills: tagsSchema,
	tags: tagsSchema,
	/** Approved alternative phrasings, usable verbatim when assembling. */
	variants: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
	/** Always include when its entry is included. */
	core: z.boolean().default(false),
	hidden: z.boolean().default(false),
});
export type ProfileAchievementInput = z.infer<typeof profileAchievementInputSchema>;

export const profileSkillInputSchema = z.object({
	name: z.string().trim().min(1).max(100),
	category: z.string().trim().max(100).default(""),
	level: z.number().int().min(1).max(5).nullable().default(null),
	years: z.number().min(0).max(60).nullable().default(null),
	/** Synonyms used when matching postings, e.g. "JS" for JavaScript. */
	aliases: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
	hidden: z.boolean().default(false),
});
export type ProfileSkillInput = z.infer<typeof profileSkillInputSchema>;

/** Which rows to reorder, in their new order. */
export const profileReorderInputSchema = z.object({
	table: z.enum(["entry", "achievement", "skill"]),
	ids: z.array(z.string().min(1)).min(1).max(500),
});
export type ProfileReorderInput = z.infer<typeof profileReorderInputSchema>;

export const assembleModeSchema = z.enum(["rephrase", "verbatim"]);
export type AssembleMode = z.infer<typeof assembleModeSchema>;

export const assembleInputSchema = z.object({
	applicationId: z.string().min(1),
	/** The resume whose contact details, design and other sections are kept. */
	baseResumeId: z.string().min(1),
	mode: assembleModeSchema.default("rephrase"),
	name: z.string().trim().min(1).max(200).optional(),
});
export type AssembleInput = z.infer<typeof assembleInputSchema>;

export const profileAssemblyResultSchema = z.object({
	coverage: z.array(
		z.object({
			requirement: z.string(),
			strength: z.enum(["strong", "partial", "none"]),
			achievementIds: z.array(z.string()),
			skillIds: z.array(z.string()),
		}),
	),
	bullets: z.array(
		z.object({
			achievementId: z.string(),
			entryId: z.string().nullable(),
			text: z.string(),
			source: z.enum(["rephrased", "original", "variant"]),
		}),
	),
	entryIds: z.array(z.string()),
	skillIds: z.array(z.string()),
	summaryUsed: z.boolean(),
	warnings: z.array(z.string()),
});
export type ProfileAssemblyResult = z.infer<typeof profileAssemblyResultSchema>;
