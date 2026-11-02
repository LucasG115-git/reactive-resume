import z from "zod";

/**
 * Structured career preferences: what the user needs, prefers or would enjoy in a job, so roles can be checked
 * and ranked with reasons. Stored inside the career profile (`structured`), next to the original fields, which
 * stay as they are. See docs/contributing/structured-preferences.mdx for how they're evaluated.
 */

/** must: rules a role out when a posting confirms it isn't met. strong: weighs on ranking. nice: a bonus. */
export const preferencePrioritySchema = z.enum(["must", "strong", "nice"]);
export type PreferencePriority = z.infer<typeof preferencePrioritySchema>;

export const workArrangementSchema = z.enum(["onsite", "hybrid", "remote"]);
export type WorkArrangement = z.infer<typeof workArrangementSchema>;

const officeDays = z.number().int().min(0).max(5).nullable().default(null);
const money = z.number().nonnegative().max(100_000_000).nullable().default(null);
const id = z.string().min(1).max(64);

/**
 * How the user would work in one area. Rules apply by specificity: a rule naming places beats a country rule,
 * which beats an "anywhere" rule; among rules of the same kind, the first in the list wins.
 */
export const locationRuleSchema = z
	.object({
		id,
		/** What the user calls the area: "Peterborough", "Greater Toronto Area", "Elsewhere in Canada". */
		label: z.string().trim().min(1).max(100),
		scope: z.enum(["places", "country", "anywhere"]),
		/** For "places": names that identify the area in a posting ("Peterborough", "Lindsay", "Cobourg"). */
		places: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
		/** For "country": ISO 3166-1 alpha-2, such as "CA". */
		country: z
			.string()
			.regex(/^[A-Z]{2}$/)
			.nullable()
			.default(null),
		/** Informational: a commuting radius from the area's centre, shared with the AI coach. */
		radiusKm: z.number().int().min(1).max(1000).nullable().default(null),
		arrangements: z.array(workArrangementSchema).min(1).max(3),
		preferredArrangement: workArrangementSchema.nullable().default(null),
		preferredOfficeDays: officeDays,
		maxOfficeDays: officeDays,
		/** Informational: shared with the AI coach; postings rarely state commute times. */
		maxCommuteMinutes: z.number().int().min(0).max(300).nullable().default(null),
		relocation: z.boolean().default(false),
		priority: preferencePrioritySchema.default("strong"),
		/** Pay for roles in this area, overriding the general salary floor and preferred minimum. */
		salaryFloor: money,
		salaryPreferred: money,
	})
	.refine(
		(rule) =>
			rule.preferredOfficeDays === null ||
			rule.maxOfficeDays === null ||
			rule.preferredOfficeDays <= rule.maxOfficeDays,
		{ message: "Preferred office days can't be more than the maximum", path: ["preferredOfficeDays"] },
	)
	.refine((rule) => rule.scope !== "places" || rule.places.length > 0, {
		message: "Add at least one place",
		path: ["places"],
	})
	.refine((rule) => rule.scope !== "country" || rule.country !== null, {
		message: "Choose a country",
		path: ["country"],
	});
export type LocationRule = z.infer<typeof locationRuleSchema>;

export const SALARY_EXCEPTIONS = ["benefits", "flexibility", "mission", "development", "other"] as const;

export const salaryPreferenceSchema = z
	.object({
		currency: z.string().regex(/^[A-Z]{3}$/),
		period: z.enum(["hour", "month", "year"]),
		/** Absolute minimum: a must-have, unless exceptions are allowed. */
		floor: money,
		/** Preferred minimum: a strong preference. */
		preferred: money,
		/** Target range: a nice-to-have. */
		targetMin: money,
		targetMax: money,
		/** What could make a role below the floor worth considering. With any set, the floor stops ruling roles out. */
		exceptions: z.array(z.enum(SALARY_EXCEPTIONS)).max(SALARY_EXCEPTIONS.length).default([]),
		exceptionNote: z.string().trim().max(500).default(""),
	})
	.refine((salary) => salary.floor === null || salary.preferred === null || salary.floor <= salary.preferred, {
		message: "The preferred minimum can't be below the absolute minimum",
		path: ["preferred"],
	})
	.refine((salary) => salary.targetMin === null || salary.targetMax === null || salary.targetMin <= salary.targetMax, {
		message: "The target range's end can't be below its start",
		path: ["targetMax"],
	});
export type SalaryPreference = z.infer<typeof salaryPreferenceSchema>;

export const ORGANIZATION_PREFERENCE_KINDS = [
	"industry",
	"organizationType",
	"mission",
	"size",
	"autonomy",
	"management",
	"development",
	"benefits",
	"employmentType",
	"other",
] as const;

/** One thing the user wants (or wants to avoid) in an organization or role, in their words. */
export const organizationPreferenceSchema = z.object({
	id,
	kind: z.enum(ORGANIZATION_PREFERENCE_KINDS),
	/** "nonprofit", "public sector", "permanent", "pension", "managing a small team". */
	value: z.string().trim().min(1).max(200),
	stance: z.enum(["want", "avoid"]).default("want"),
	priority: preferencePrioritySchema.default("nice"),
});
export type OrganizationPreference = z.infer<typeof organizationPreferenceSchema>;

export const structuredPreferencesSchema = z.object({
	version: z.literal(1).default(1),
	locationRules: z.array(locationRuleSchema).max(20).default([]),
	salary: salaryPreferenceSchema.nullable().default(null),
	organization: z.array(organizationPreferenceSchema).max(40).default([]),
});
export type StructuredPreferences = z.infer<typeof structuredPreferencesSchema>;

export const EMPTY_STRUCTURED_PREFERENCES: StructuredPreferences = structuredPreferencesSchema.parse({});

// ---- Evaluation results, as the API returns them ----

export const preferenceCheckSchema = z.object({
	/** Stable per preference, so an override can name it: "location:<ruleId>:arrangement", "salary:floor", "org:<id>". */
	key: z.string(),
	label: z.string(),
	priority: preferencePrioritySchema,
	status: z.enum(["met", "violated", "unknown", "overridden"]),
	/** Why, in a sentence, naming what the posting said or didn't say. */
	detail: z.string(),
	/** Set when the preference came from the original (pre-structured) settings. */
	legacy: z.boolean().default(false),
});
export type PreferenceCheck = z.infer<typeof preferenceCheckSchema>;

export const preferenceEvaluationSchema = z.object({
	/**
	 * conflict: a must-have is confirmed unmet. check: no must-have is unmet, but some are unconfirmed.
	 * fits: every must-have is confirmed met, or there are none.
	 */
	verdict: z.enum(["fits", "check", "conflict"]),
	/** One plain sentence on why the role sits where it does. */
	summary: z.string(),
	checks: z.array(preferenceCheckSchema),
	/** The location rule that applied, if any. */
	rule: z.object({ id: z.string(), label: z.string() }).nullable(),
});
export type PreferenceEvaluation = z.infer<typeof preferenceEvaluationSchema>;
