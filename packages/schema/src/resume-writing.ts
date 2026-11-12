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
			experiencedYears: z.number().int().min(0).max(30).default(10),
		})
		.default({ experienced: 2, early: 1, experiencedYears: 10 }),
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

/** The page target for a candidate with this many years of experience. */
export const pagesFor = (rules: Pick<WritingRules, "pages">, years: number) =>
	years >= rules.pages.experiencedYears ? rules.pages.experienced : rules.pages.early;

/** Years since the first position started, as page targets count them. */
export function yearsSinceFirstRole(entries: Array<{ kind: string; startDate: string | null }>, now: Date) {
	const starts = entries
		.filter((entry) => entry.kind === "position" && entry.startDate)
		.map((entry) => Number(entry.startDate?.slice(0, 4)));
	return starts.length ? now.getFullYear() - Math.min(...starts) : 0;
}

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
		// Rendering validation: the exported files, read back.
		"render-failed",
		"render-blank-page",
		"render-text-missing",
		"render-reading-order",
		"render-pages",
		"render-ats",
		"docx-text-missing",
		"render-sparse-page",
		// What could put a hiring manager off.
		"evidence-note",
		"sensitive-content",
		"tense-mixed",
		"headline-list",
		"hedging",
		"thin-skill-group",
		"approximate-exact",
		"trimmed-to-fit",
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

// ---- AI review ----

export const REVIEW_CATEGORIES = [
	"relevance",
	"strength",
	"prioritization",
	"tone",
	"clarity",
	"redundancy",
	"accuracy",
] as const;

/** A judgment the reviewer made about the draft. Advice only; it changes nothing by itself. */
export const reviewFindingSchema = z.object({
	category: z.enum(REVIEW_CATEGORIES),
	severity: z.enum(["high", "medium", "low"]),
	message: z.string(),
	/** "summary", "headline", "skills", or the achievement id of a bullet. */
	ref: z.string().nullable(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/**
 * A rewrite the reviewer suggested. applied: wording only, passed the same record checks as the writer, and was
 * put in the resume. needs-review: it would change what a line claims, or failed a check; it waits for the user.
 * reverted: the user put the draft wording back. dismissed: the user declined it.
 */
export const reviewRevisionSchema = z.object({
	target: z.enum(["bullet", "summary"]),
	achievementId: z.string().nullable(),
	before: z.string(),
	after: z.string(),
	status: z.enum(["applied", "needs-review", "reverted", "dismissed"]),
	reason: z.string(),
});
export type ReviewRevision = z.infer<typeof reviewRevisionSchema>;

/** Most rewrites the reviewer may apply in its one round; the draft wording of each is kept. */
export const MAX_REVIEW_REVISIONS = 5;

export const resumeReviewSchema = z.object({
	model: z.string(),
	/** 0–10 overall, from the reviewer. */
	score: z.number().min(0).max(10).nullable(),
	findings: z.array(reviewFindingSchema),
	revisions: z.array(reviewRevisionSchema),
	promptVersion: z.string(),
});
export type ResumeReview = z.infer<typeof resumeReviewSchema>;

// ---- Rendering validation ----

export const renderingReportSchema = z.object({
	pdf: z
		.object({
			pages: z.number(),
			/** 1-based page numbers with no text. */
			blankPages: z.array(z.number()),
			/** Share of the resume's bullets, title and contact found in the PDF's extracted text, 0–1. */
			textCoverage: z.number(),
			/** Lines not found in the extracted text. */
			missing: z.array(z.string()),
			/** Positions read back in the order they were written. */
			readingOrder: z.boolean(),
			/** The ATS checker's 0–100 score for the file. */
			atsScore: z.number().nullable(),
			/** How far down the last page the text reaches, 0–1. */
			lastPageFill: z.number().optional(),
		})
		.nullable(),
	docx: z.object({ textCoverage: z.number(), missing: z.array(z.string()) }).nullable(),
	/** Why a file couldn't be checked. */
	errors: z.array(z.string()).default([]),
});
export type RenderingReport = z.infer<typeof renderingReportSchema>;

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
	/** The AI reviewer's findings and rewrites, when it ran. */
	review: resumeReviewSchema.optional(),
	/** The exported PDF and DOCX, read back. */
	rendering: renderingReportSchema.optional(),
	/** Prompt versions used, for comparing runs. */
	promptVersions: z.record(z.string(), z.string()).default({}),
});
export type WritingReport = z.infer<typeof writingReportSchema>;

// ---- Feedback ----

/** A line of a generated resume the user changed, learned from their edits. */
export const resumeCorrectionSchema = z.object({
	target: z.enum(["bullet", "summary", "headline"]),
	achievementId: z.string().nullable(),
	generated: z.string(),
	edited: z.string(),
});
export type ResumeCorrection = z.infer<typeof resumeCorrectionSchema>;

/**
 * The user's verdict on a generated resume and the changes they made to it. Used as writing preferences for later
 * resumes; never as facts, and the master profile is never changed by it.
 */
export const resumeFeedbackSchema = z.object({
	id: z.string(),
	applicationId: z.string(),
	assemblyId: z.string().nullable(),
	rating: z.enum(["good", "needs-work"]).nullable(),
	note: z.string(),
	corrections: z.array(resumeCorrectionSchema),
	createdAt: z.coerce.date(),
});
export type ResumeFeedback = z.infer<typeof resumeFeedbackSchema>;

export const resumeFeedbackInputSchema = z.object({
	assemblyId: z.string().min(1),
	rating: z.enum(["good", "needs-work"]).nullable().default(null),
	note: z.string().trim().max(1000).default(""),
	/** Compare the resume as it is now with what was generated, and keep the lines the user changed. */
	learnFromEdits: z.boolean().default(true),
});
export type ResumeFeedbackInput = z.infer<typeof resumeFeedbackInputSchema>;
