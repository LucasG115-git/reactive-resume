import z from "zod";
import { SELECTION_SECTIONS } from "./resume-selection";
import { DEFAULT_WRITING_RULES, writingRulesSchema } from "./resume-writing";

/**
 * The Resume Style Guide: how the user likes resumes written, as presets for the directions they apply in
 * (Communications, Project Management…). Separate from Career Knowledge: it shapes wording and layout, never facts.
 */

export const ROLE_FAMILIES = [
	"general",
	"communications",
	"digital-marketing",
	"project-management",
	"web-development",
	"other",
] as const;
export const roleFamilySchema = z.enum(ROLE_FAMILIES);
export type RoleFamily = z.infer<typeof roleFamilySchema>;

/** plain: clear and neutral. warm: approachable, people-first. confident: direct, assertive verbs. formal: reserved. */
export const TONES = ["plain", "warm", "confident", "formal"] as const;
/** action-result: verb, what, result. challenge-action-result: the situation first when it matters. concise: one tight clause. */
export const BULLET_STYLES = ["action-result", "challenge-action-result", "concise"] as const;
export const DENSITIES = ["light", "balanced", "dense"] as const;

const id = z.string().min(1).max(64);

export const styleExampleSchema = z.object({
	id,
	title: z.string().trim().min(1).max(120),
	source: z.enum(["resume", "upload"]),
	/** The resume it was taken from, when picked from your documents. */
	resumeId: z.string().nullable().default(null),
	/** The example's text, kept as it was when added; used for style only, never as evidence. */
	text: z.string().max(15_000),
	/** What you like about it ("tight bullets", "the summary's voice"). */
	notes: z.string().trim().max(500).default(""),
	addedAt: z.iso.datetime({ offset: true }),
});
export type StyleExample = z.infer<typeof styleExampleSchema>;

export const stylePresetSchema = z.object({
	id,
	name: z.string().trim().min(1).max(60),
	roleFamily: roleFamilySchema.default("general"),
	/** Words in a posting's title that pick this preset automatically ("communications", "marketing"). */
	keywords: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
	tone: z.enum(TONES).default("plain"),
	bulletStyle: z.enum(BULLET_STYLES).default("action-result"),
	density: z.enum(DENSITIES).default("balanced"),
	rules: writingRulesSchema.default(DEFAULT_WRITING_RULES),
	/** Positions ending within this many years count as recent; older ones get briefer treatment. */
	recentYears: z.number().int().min(1).max(40).default(10),
	olderRoles: z.enum(["full", "brief"]).default("brief"),
	/** Section order to use instead of each selection's recommendation; null keeps the recommendation. */
	sectionOrder: z.array(z.enum(SELECTION_SECTIONS)).nullable().default(null),
	/** Skill group names to prefer, when they fit ("Communications & Marketing", "Digital Platforms"). */
	skillGroupHints: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
	/** Examples (by id) this preset writes like. */
	exampleIds: z.array(id).max(3).default([]),
	/** Anything else, in your words ("Use 'led' sparingly", "No first person"). */
	notes: z.string().trim().max(1000).default(""),
});
export type StylePreset = z.infer<typeof stylePresetSchema>;

export const resumeStyleGuideSchema = z
	.object({
		version: z.literal(1).default(1),
		defaultPresetId: id,
		presets: z.array(stylePresetSchema).min(1).max(12),
		examples: z.array(styleExampleSchema).max(6).default([]),
	})
	.refine((guide) => guide.presets.some((preset) => preset.id === guide.defaultPresetId), {
		message: "Choose a default preset",
		path: ["defaultPresetId"],
	});
export type ResumeStyleGuide = z.infer<typeof resumeStyleGuideSchema>;

type Template = Omit<StylePreset, "id" | "exampleIds" | "notes">;

/** Starting points for each direction; users copy and change them. */
export const ROLE_FAMILY_TEMPLATES: Record<RoleFamily, Template> = {
	general: {
		name: "General",
		roleFamily: "general",
		keywords: [],
		tone: "plain",
		bulletStyle: "action-result",
		density: "balanced",
		rules: DEFAULT_WRITING_RULES,
		recentYears: 10,
		olderRoles: "brief",
		sectionOrder: null,
		skillGroupHints: [],
	},
	communications: {
		name: "Communications",
		roleFamily: "communications",
		keywords: [
			"communications",
			"communication",
			"comms",
			"media",
			"public relations",
			"content",
			"engagement",
			"outreach",
		],
		tone: "warm",
		bulletStyle: "action-result",
		density: "balanced",
		rules: DEFAULT_WRITING_RULES,
		recentYears: 10,
		olderRoles: "brief",
		sectionOrder: ["summary", "experience", "skills", "projects", "volunteer", "education", "certifications", "awards"],
		skillGroupHints: ["Communications & Marketing", "Digital Platforms", "Project Delivery"],
	},
	"digital-marketing": {
		name: "Digital Marketing",
		roleFamily: "digital-marketing",
		keywords: ["marketing", "digital", "seo", "social media", "growth", "campaign", "brand"],
		tone: "confident",
		bulletStyle: "action-result",
		density: "balanced",
		rules: DEFAULT_WRITING_RULES,
		recentYears: 8,
		olderRoles: "brief",
		sectionOrder: ["summary", "skills", "experience", "projects", "education", "certifications", "volunteer", "awards"],
		skillGroupHints: ["Marketing Channels", "Analytics & Tools", "Content & Creative"],
	},
	"project-management": {
		name: "Project Management",
		roleFamily: "project-management",
		keywords: ["project", "program", "programme", "coordinator", "delivery", "operations", "pmo"],
		tone: "formal",
		bulletStyle: "challenge-action-result",
		density: "balanced",
		rules: DEFAULT_WRITING_RULES,
		recentYears: 12,
		olderRoles: "brief",
		sectionOrder: ["summary", "experience", "skills", "certifications", "education", "projects", "volunteer", "awards"],
		skillGroupHints: ["Project Delivery", "Stakeholder Engagement", "Tools & Methods"],
	},
	"web-development": {
		name: "Web Development",
		roleFamily: "web-development",
		keywords: ["developer", "development", "engineer", "web", "front-end", "frontend", "full-stack", "wordpress"],
		tone: "plain",
		bulletStyle: "concise",
		density: "dense",
		rules: DEFAULT_WRITING_RULES,
		recentYears: 8,
		olderRoles: "brief",
		sectionOrder: ["summary", "skills", "experience", "projects", "education", "certifications", "volunteer", "awards"],
		skillGroupHints: ["Languages & Frameworks", "Platforms & CMS", "Practices & Tools"],
	},
	other: {
		name: "Other",
		roleFamily: "other",
		keywords: [],
		tone: "plain",
		bulletStyle: "action-result",
		density: "balanced",
		rules: DEFAULT_WRITING_RULES,
		recentYears: 10,
		olderRoles: "brief",
		sectionOrder: null,
		skillGroupHints: [],
	},
};

export const presetFromTemplate = (family: RoleFamily, presetId: string): StylePreset =>
	stylePresetSchema.parse({ ...ROLE_FAMILY_TEMPLATES[family], id: presetId, exampleIds: [], notes: "" });

/** What everyone starts with: one General preset with the default rules. */
export const DEFAULT_STYLE_GUIDE: ResumeStyleGuide = {
	version: 1,
	defaultPresetId: "general",
	presets: [presetFromTemplate("general", "general")],
	examples: [],
};

const lower = (text: string) =>
	` ${text
		.toLowerCase()
		.replace(/[^a-z0-9+#]+/g, " ")
		.trim()} `;

/**
 * The preset for a posting: the one chosen, else the one whose keywords best match the title (or, more weakly, the
 * posting's summary and field, so "Officer, Recruitment" still finds a communications preset), else the default.
 */
export function choosePreset(
	guide: ResumeStyleGuide,
	title: string,
	chosenId?: string | null,
	context = "",
): StylePreset {
	const chosen = chosenId ? guide.presets.find((preset) => preset.id === chosenId) : undefined;
	if (chosen) return chosen;
	const haystack = lower(title);
	const around = lower(context);
	let best: { preset: StylePreset; hits: number } | null = null;
	for (const preset of guide.presets) {
		// Matched at the start of a word, so "project" also matches "Projects". Title matches count double.
		const hits = preset.keywords.reduce((sum, keyword) => {
			const word = lower(keyword).trimEnd();
			return sum + (haystack.includes(word) ? 2 : around.includes(word) ? 1 : 0);
		}, 0);
		if (hits > 0 && (!best || hits > best.hits)) best = { preset, hits };
	}
	const fallback = guide.presets.find((preset) => preset.id === guide.defaultPresetId) ?? guide.presets[0];
	return best?.preset ?? (fallback as StylePreset);
}

/** The writing rules a preset implies: its rules, with bullet length following its density. */
export function rulesFor(preset: StylePreset) {
	const factor = preset.density === "light" ? 0.85 : preset.density === "dense" ? 1.15 : 1;
	const maxWords = Math.round(preset.rules.bullets.maxWords * factor);
	return { ...preset.rules, bullets: { ...preset.rules.bullets, maxWords } };
}
