import z from "zod";
import { tokenUsageSchema } from "./ai-tasks";

/**
 * Resume writing, step two of tailoring: rules for turning a reviewed Resume Selection Plan into resume text,
 * and the quality findings checked before the result is shown. Rules are guidelines: the writer and checks use
 * them to aim and to warn, never to cut content the user chose or to shrink text to fit.
 */

export const WRITING_REGIONS = ["CA", "US", "GB", "AU", "other"] as const;
export const writingRegionSchema = z.enum(WRITING_REGIONS);
export type WritingRegion = z.infer<typeof writingRegionSchema>;

/** What each region's conventions mean for the writer and the checks. */
export const REGION_CONVENTIONS: Record<
	WritingRegion,
	{ label: string; spelling: string; personalDetails: string; pagesExperienced: number; pagesEarly: number }
> = {
	CA: {
		label: "Canada",
		spelling: "Canadian English spelling (centre, colour, organization)",
		personalDetails: "No photo, date of birth, age, marital status or social insurance number",
		pagesExperienced: 2,
		pagesEarly: 1,
	},
	US: {
		label: "United States",
		spelling: "American English spelling",
		personalDetails: "No photo, date of birth, age or marital status",
		pagesExperienced: 2,
		pagesEarly: 1,
	},
	GB: {
		label: "United Kingdom",
		spelling: "British English spelling",
		personalDetails: "No photo, date of birth or marital status",
		pagesExperienced: 2,
		pagesEarly: 2,
	},
	AU: {
		label: "Australia",
		spelling: "Australian English spelling",
		personalDetails: "No photo, date of birth or marital status",
		pagesExperienced: 3,
		pagesEarly: 2,
	},
	other: {
		label: "Other",
		spelling: "the resume's language and its usual spelling",
		personalDetails: "Only the personal details customary where you're applying",
		pagesExperienced: 2,
		pagesEarly: 1,
	},
};

export const writingRulesSchema = z.object({
	region: writingRegionSchema.default("CA"),
	/** Pages to aim for with more than `experiencedYears` of experience, and below it. */
	pages: z
		.object({
			experienced: z.number().int().min(1).max(4).default(2),
			early: z.number().int().min(1).max(4).default(1),
			experiencedYears: z.number().int().min(0).max(30).default(5),
		})
		.default({ experienced: 2, early: 1, experiencedYears: 5 }),
	/** Usual number of positions; more is fine when the user includes them. */
	positions: z
		.object({ min: z.number().int().min(1).default(3), max: z.number().int().min(1).default(5) })
		.default({ min: 3, max: 5 }),
	/** Bullets for major recent roles, and for older or less relevant ones. */
	bullets: z
		.object({
			majorMin: z.number().int().min(1).default(3),
			majorMax: z.number().int().min(1).default(5),
			otherMax: z.number().int().min(0).default(3),
			/** Words per bullet beyond which it reads as a paragraph. */
			maxWords: z.number().int().min(10).default(35),
		})
		.default({ majorMin: 3, majorMax: 5, otherMax: 3, maxWords: 35 }),
	summary: z
		.object({
			enabled: z.boolean().default(true),
			minSentences: z.number().int().min(1).default(2),
			maxSentences: z.number().int().min(1).default(3),
			maxWords: z.number().int().min(20).default(75),
		})
		.default({ enabled: true, minSentences: 2, maxSentences: 3, maxWords: 75 }),
	headline: z.boolean().default(true),
	skills: z
		.object({
			min: z.number().int().min(0).default(8),
			max: z.number().int().min(1).default(15),
			minGroups: z.number().int().min(1).default(2),
			maxGroups: z.number().int().min(1).default(4),
		})
		.default({ min: 8, max: 15, minGroups: 2, maxGroups: 4 }),
	/** Words in a two-column template page, used to estimate length before rendering. */
	wordsPerPage: z.number().int().min(200).max(900).default(500),
});
export type WritingRules = z.infer<typeof writingRulesSchema>;
export const DEFAULT_WRITING_RULES: WritingRules = writingRulesSchema.parse({});

export const qualityFindingSchema = z.object({
	/** Stable, so findings can be counted and compared across runs. */
	code: z.enum([
		"unsupported-bullet",
		"missing-source",
		"title-mismatch",
		"date-mismatch",
		"entry-not-in-profile",
		"order",
		"duplicate-bullet",
		"skills-count",
		"duplicate-skill",
		"unsupported-skill",
		"soft-skill",
		"missing-section",
		"missing-contact",
		"summary-length",
		"bullet-length",
		"empty-entry",
		"too-long",
		"too-short",
		"cliche",
		"keyword-repetition",
		"personal-details",
		"heading",
		"placeholder",
	]),
	severity: z.enum(["error", "warning", "info"]),
	message: z.string(),
	/** Where: a section, or an item's id in the resume. */
	section: z.string().optional(),
	itemId: z.string().optional(),
});
export type QualityFinding = z.infer<typeof qualityFindingSchema>;

export const skillGroupSchema = z.object({
	name: z.string(),
	/** profile_skill ids, in print order. */
	skillIds: z.array(z.string()),
});
export type SkillGroup = z.infer<typeof skillGroupSchema>;

/** What the writing step produced, kept with the assembly for review and comparison. */
export const writingReportSchema = z.object({
	headline: z.string(),
	summary: z.string(),
	skillGroups: z.array(skillGroupSchema),
	/** Skills left out by the skills rules, with why. */
	skillsLeftOut: z.array(z.object({ skillId: z.string(), name: z.string(), reason: z.string() })),
	checks: z.array(qualityFindingSchema),
	stats: z.object({
		words: z.number(),
		estimatedPages: z.number(),
		targetPages: z.number(),
		positions: z.number(),
		bullets: z.number(),
		skills: z.number(),
	}),
	rules: writingRulesSchema,
	/** Model calls for writing, with tokens used, and the quality mode. */
	usage: z.array(tokenUsageSchema).default([]),
	quality: z.enum(["standard", "thorough"]).default("standard"),
	/** The Resume Style Guide preset written with. */
	style: z.object({ presetId: z.string(), name: z.string() }).optional(),
});
export type WritingReport = z.infer<typeof writingReportSchema>;
