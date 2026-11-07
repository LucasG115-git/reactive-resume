import z from "zod";
import { tokenUsageSchema } from "./ai-tasks";

/**
 * Resume tailoring, step one: a job posting analysed into ranked requirements, and a reviewable Resume Selection
 * Plan saying which records from the full master profile go on this application's resume, and why. The plan is
 * the contract the resume-writing step consumes. See docs/contributing/resume-selection.mdx.
 */

// ---- Job analysis ----

export const SENIORITY_LEVELS = [
	"entry",
	"junior",
	"intermediate",
	"senior",
	"lead",
	"manager",
	"executive",
	"unknown",
] as const;
export const seniorityLevelSchema = z.enum(SENIORITY_LEVELS);

export const REQUIREMENT_KINDS = ["responsibility", "qualification", "skill", "domain", "competency"] as const;

export const jobRequirementSchema = z.object({
	/** "R1", "R2", … in rank order: R1 matters most. */
	id: z.string().regex(/^R\d+$/),
	text: z.string().trim().min(1).max(300),
	kind: z.enum(REQUIREMENT_KINDS),
	/** mandatory: the posting requires it. preferred: an asset or "nice to have". */
	necessity: z.enum(["mandatory", "preferred"]),
	/** explicit: the posting states it. inferred: a reasonable reading between the lines. */
	origin: z.enum(["explicit", "inferred"]),
	/** 1–5, importance to doing the job, not how often it's mentioned. */
	importance: z.number().int().min(1).max(5),
	/** Other ways a record could say it ("donor relations" for "fundraising"), used to match evidence. */
	terms: z.array(z.string().trim().min(1).max(80)).max(15).default([]),
});
export type JobRequirement = z.infer<typeof jobRequirementSchema>;

export const jobAnalysisSchema = z.object({
	version: z.literal(1).default(1),
	title: z.string().max(200),
	employer: z.string().max(200),
	seniority: seniorityLevelSchema,
	/** One sentence on what the role is for. */
	summary: z.string().max(600).default(""),
	responsibilities: z.array(z.string().max(300)).max(15).default([]),
	/** Ranked: R1 first. */
	requirements: z.array(jobRequirementSchema).max(30),
	/** Sector or subject knowledge the role needs ("nonprofit fundraising", "municipal government"). */
	domain: z.array(z.string().max(120)).max(10).default([]),
	/** SHA-256 of the posting text analysed, to know when it changed. */
	postingHash: z.string(),
	analyzedAt: z.iso.datetime({ offset: true }),
	model: z.string().default(""),
});
export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

// ---- Resume Selection Plan ----

export const SELECTION_SECTIONS = [
	"summary",
	"skills",
	"experience",
	"projects",
	"volunteer",
	"education",
	"certifications",
	"awards",
] as const;
export const selectionSectionSchema = z.enum(SELECTION_SECTIONS);
export type SelectionSection = z.infer<typeof selectionSectionSchema>;

/** Why the recommendation came out as it did, in the ranking's own terms. */
export const selectionScoreSchema = z.object({
	/** 0–1: the combined score used to rank and choose. */
	total: z.number(),
	/** 0–1: how well it answers the posting's requirements, weighted by importance. */
	alignment: z.number(),
	/** 0–1: measured results, specificity, always-include. */
	strength: z.number(),
	/** 0–1: how recent its entry is. Never rules anything out alone. */
	recency: z.number(),
	/** 0–1: how long the candidate held the entry's role; where most of their experience was built. */
	tenure: z.number().default(0.5),
	/** 0–3 from the AI review, or null when the AI didn't rate it. */
	aiRelevance: z.number().nullable(),
});
export type SelectionScore = z.infer<typeof selectionScoreSchema>;

export const planAchievementSchema = z.object({
	/** profile_achievement.id: the source record. */
	achievementId: z.string(),
	/** The recorded text, for display; the writing step reads the profile record by id. */
	text: z.string(),
	include: z.boolean(),
	/** Requirement ids this achievement evidences. */
	requirementIds: z.array(z.string()),
	reason: z.string(),
	score: selectionScoreSchema,
	/** Set when the user changed include or order, so their choice survives a re-review. */
	userEdited: z.boolean().default(false),
	core: z.boolean().default(false),
});
export type PlanAchievement = z.infer<typeof planAchievementSchema>;

export const planEntrySchema = z.object({
	/** profile_entry.id: the source record. */
	entryId: z.string(),
	kind: z.enum(["position", "project", "education", "volunteer", "certification", "award"]),
	title: z.string(),
	organization: z.string(),
	startDate: z.string().nullable(),
	endDate: z.string().nullable(),
	include: z.boolean(),
	reason: z.string(),
	/** Suggested number of bullets; the writer may use fewer, never more without reason. */
	bulletTarget: z.number().int().min(0).max(100),
	/** Requirement ids the entry's own title, scope and tags relate to (credentials, degrees). */
	requirementIds: z.array(z.string()).default([]),
	/** Every visible achievement of the entry, in the order to print the included ones. */
	achievements: z.array(planAchievementSchema),
	userEdited: z.boolean().default(false),
});
export type PlanEntry = z.infer<typeof planEntrySchema>;

export const planSkillSchema = z.object({
	skillId: z.string(),
	name: z.string(),
	category: z.string(),
	include: z.boolean(),
	requirementIds: z.array(z.string()),
	/** Shown by an included achievement, not only listed. */
	evidenced: z.boolean(),
	reason: z.string(),
	userEdited: z.boolean().default(false),
});
export type PlanSkill = z.infer<typeof planSkillSchema>;

export const requirementCoverageSchema = z.object({
	requirementId: z.string(),
	/**
	 * supported: an included achievement demonstrates it. partial: only a listed skill, a weak match, or an entry's
	 * scope does. gap: nothing included does; `available` says whether the profile has unselected evidence.
	 */
	status: z.enum(["supported", "partial", "gap"]),
	achievementIds: z.array(z.string()),
	skillIds: z.array(z.string()),
	/** Included entries whose own title or scope relates to it (a certificate, a degree, a role's scope). */
	entryIds: z.array(z.string()).default([]),
	/** Achievement ids in the profile that could support it but aren't included. */
	available: z.array(z.string()),
});
export type RequirementCoverage = z.infer<typeof requirementCoverageSchema>;

export const resumeSelectionPlanSchema = z.object({
	version: z.literal(1).default(1),
	applicationId: z.string(),
	createdAt: z.iso.datetime({ offset: true }),
	/** ai: the AI reviewed a ranked shortlist. ranking: the deterministic ranking alone (no AI response). */
	source: z.enum(["ai", "ranking"]),
	/** One sentence on how to position the candidate for this role. */
	positioning: z.string().default(""),
	/** Recommended order of resume sections; sections with nothing included are left out. */
	sections: z.array(selectionSectionSchema),
	/** Every visible profile entry (the full record), with include deciding this resume's subset. */
	entries: z.array(planEntrySchema),
	/** Achievements not attached to an entry: they can inform the summary but can't be placed as bullets. */
	standalone: z.array(planAchievementSchema),
	skills: z.array(planSkillSchema),
	coverage: z.array(requirementCoverageSchema),
	/** Records left out before ranking: hidden, switched off, or private to another application. */
	unavailable: z.array(
		z.object({ id: z.string(), kind: z.enum(["entry", "achievement", "skill"]), reason: z.string() }),
	),
	/** Incomplete or conflicting source information worth checking (missing dates, duplicate achievements…). */
	warnings: z.array(z.string()),
	/** Model calls that produced the plan, with tokens used. */
	usage: z.array(tokenUsageSchema).default([]),
	/** The full record vs the subset, for display. */
	totals: z.object({
		entries: z.number(),
		achievements: z.number(),
		skills: z.number(),
		includedEntries: z.number(),
		includedAchievements: z.number(),
		includedSkills: z.number(),
	}),
});
export type ResumeSelectionPlan = z.infer<typeof resumeSelectionPlanSchema>;

/** A user's edits: include/exclude and order, never the records themselves. */
export const selectionEditSchema = z.object({
	applicationId: z.string().min(1),
	entries: z
		.array(
			z.object({
				entryId: z.string(),
				include: z.boolean(),
				/** Achievement ids in the order to print, with their include flags. */
				achievements: z.array(z.object({ achievementId: z.string(), include: z.boolean() })).max(200),
			}),
		)
		.max(300),
	skills: z.array(z.object({ skillId: z.string(), include: z.boolean() })).max(500),
});
export type SelectionEdit = z.infer<typeof selectionEditSchema>;
