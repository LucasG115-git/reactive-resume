import type { MasterProfile } from "../service";
import type { Placement } from "../writing/checks";
import type { ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import type { SkillGroup } from "@reactive-resume/schema/resume-writing";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import { generateId } from "@reactive-resume/utils/string";
import { checkGrounded, lengthBudget } from "./grounding";

type Entry = MasterProfile["entries"][number];
type Achievement = Entry["achievements"][number];
type Skill = MasterProfile["skills"][number];

export type AssembleMode = "rephrase" | "verbatim";

/** What the model sends back, after its short ids have been mapped to real ids. */
export type Selection = {
	/** Chosen achievements, most relevant first, with the model's wording. */
	achievements: Array<{ id: string; text: string }>;
	/** Skill ids, most relevant first. */
	skills: string[];
	/** A 2–3 sentence profile summary, or "" for none. */
	summary: string;
};

export type AssembledBullet = {
	achievementId: string;
	entryId: string | null;
	text: string;
	/** "rephrased" passed the grounding check; "original" is the user's text or an approved variant. */
	source: "rephrased" | "original" | "variant";
};

export type AssembleResult = {
	data: ResumeData;
	bullets: AssembledBullet[];
	entryIds: string[];
	skillIds: string[];
	summaryUsed: boolean;
	warnings: string[];
	/** Which profile entry each resume item came from. */
	placements: Placement[];
};

export const LIMITS = {
	/** Bullets for a position that ended within the last five years, or is ongoing. */
	recentPosition: 5,
	olderPosition: 3,
	other: 3,
	/** Positions within this many years appear even without a selected bullet, so the timeline has no gap. */
	keepPositionYears: 10,
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);

export const bulletsHtml = (bullets: string[]) =>
	bullets.length === 0 ? "" : `<ul>${bullets.map((text) => `<li><p>${escapeHtml(text)}</p></li>`).join("")}</ul>`;

const paragraphHtml = (text: string) => (text ? `<p>${escapeHtml(text)}</p>` : "");

function yearOf(value: string | null): number | null {
	return value ? Number(value.slice(0, 4)) : null;
}

export function isRecent(entry: Pick<Entry, "startDate" | "endDate">, now: Date, years: number) {
	// Ongoing (or undated) entries count as recent.
	if (!entry.endDate) return true;
	const end = yearOf(entry.endDate);
	return end !== null && now.getFullYear() - end <= years;
}

/** Ongoing first, then latest end, then latest start: the order resumes list entries in. */
export function byRecency(a: Entry, b: Entry) {
	const end = (entry: Entry) => entry.endDate ?? (entry.startDate ? "9999" : "0000");
	return end(b).localeCompare(end(a)) || (b.startDate ?? "").localeCompare(a.startDate ?? "");
}

function datesOf(entry: Entry, single = false): ResumeDates {
	if (single) return { start: entry.endDate ?? entry.startDate, end: null, present: false };
	return { start: entry.startDate, end: entry.endDate, present: Boolean(entry.startDate && !entry.endDate) };
}

const website = (url: string) => ({ url, label: "", inlineLink: false });

/** Every wording the user wrote for an achievement: its text and approved variants. */
const wordingsOf = (achievement: Achievement) => [achievement.text, ...achievement.variants];

/**
 * Picks the wording to print. Rephrased text must pass the grounding check against the user's own
 * wordings and metrics; otherwise the user's text is used and a warning explains why.
 */
export function chooseWording(
	achievement: Achievement,
	proposed: string,
	mode: AssembleMode,
	warnings: string[],
): Pick<AssembledBullet, "text" | "source"> {
	const candidate = proposed.trim();
	const variant = achievement.variants.find((wording) => wording.trim() === candidate);
	if (variant) return { text: variant, source: "variant" };
	if (mode === "verbatim" || !candidate || candidate === achievement.text)
		return { text: achievement.text, source: "original" };

	const sources = [...wordingsOf(achievement), ...achievement.metrics.map((m) => `${m.value} ${m.unit} ${m.label}`)];
	const check = checkGrounded(candidate, sources, lengthBudget(wordingsOf(achievement)));
	if (check.ok) return { text: candidate, source: "rephrased" };

	warnings.push(`Kept your wording for "${truncate(achievement.text)}" (the rewrite ${check.reason}).`);
	return { text: achievement.text, source: "original" };
}

/** Section types the profile supplies; custom sections of these types would repeat what's assembled. */
const ASSEMBLED_TYPES = new Set([
	"experience",
	"projects",
	"education",
	"volunteer",
	"certifications",
	"awards",
	"skills",
]);

/**
 * Empties and hides the base resume's custom sections of assembled types ("Earlier experience"), so their old
 * content doesn't print beside the assembled sections. They stay in place, so layouts referring to them still work.
 */
export function clearAssembledCustomSections(sections: ResumeData["customSections"]): ResumeData["customSections"] {
	return sections.map((section) =>
		ASSEMBLED_TYPES.has(section.type) ? ({ ...section, items: [], hidden: true } as typeof section) : section,
	);
}

const truncate = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Builds resume data from a base resume (whose contact details, design and other sections are kept)
 * and a selection from the master profile. Only profile content the user recorded reaches the resume.
 */
export function buildResume(input: {
	base: ResumeData;
	profile: MasterProfile;
	selection: Selection;
	mode: AssembleMode;
	now?: Date;
	/**
	 * A reviewed Resume Selection Plan. With one, it decides which entries, achievements (in its order, uncapped)
	 * and skills appear; the selection only supplies wording and the summary.
	 */
	plan?: ResumeSelectionPlan | null | undefined;
	/** The writing step's headline and skill groups; with them, skills print in these groups only. */
	writing?:
		| { headline: string; skillGroups: SkillGroup[]; sectionOrder?: string[] | null | undefined }
		| null
		| undefined;
}): AssembleResult {
	const { base, profile, selection, mode, plan } = input;
	const now = input.now ?? new Date();
	const warnings: string[] = [];

	const entries = profile.entries.filter((entry) => !entry.hidden);
	const visibleAchievements = new Map<string, Achievement>();
	for (const entry of entries)
		for (const achievement of entry.achievements)
			if (!achievement.hidden) visibleAchievements.set(achievement.id, achievement);
	for (const achievement of profile.standalone)
		if (!achievement.hidden) visibleAchievements.set(achievement.id, achievement);

	// Selected bullets per entry, in the model's order of relevance, capped per entry.
	const chosen = new Map<string | null, Array<{ achievement: Achievement; proposed: string }>>();
	const seen = new Set<string>();
	const wording = new Map(selection.achievements.map((pick) => [pick.id, pick.text]));
	const planned = plan
		? plan.entries
				.filter((entry) => entry.include)
				.flatMap((entry) =>
					entry.achievements
						.filter((item) => item.include)
						.map((item) => ({ id: item.achievementId, text: wording.get(item.achievementId) ?? "" })),
				)
		: null;
	if (plan) {
		const missing = plan.entries
			.filter((entry) => entry.include)
			.flatMap((entry) =>
				entry.achievements.filter((item) => item.include && !visibleAchievements.has(item.achievementId)),
			);
		if (missing.length > 0)
			warnings.push(`${missing.length} planned achievement(s) are no longer in your profile, so they were left out.`);
	}
	for (const pick of planned ?? selection.achievements) {
		const achievement = visibleAchievements.get(pick.id);
		if (!achievement || seen.has(pick.id)) continue;
		seen.add(pick.id);
		const list = chosen.get(achievement.entryId) ?? [];
		list.push({ achievement, proposed: pick.text });
		chosen.set(achievement.entryId, list);
	}

	const capFor = (entry: Entry) =>
		entry.kind === "position" ? (isRecent(entry, now, 5) ? LIMITS.recentPosition : LIMITS.olderPosition) : LIMITS.other;

	// Which entries appear: the plan's, or anything with a chosen bullet, recent positions, all education and certifications.
	const planEntries = plan
		? new Set(plan.entries.filter((entry) => entry.include).map((entry) => entry.entryId))
		: null;
	const included = entries.filter((entry) => {
		if (planEntries) return planEntries.has(entry.id);
		if (chosen.has(entry.id)) return true;
		if (entry.kind === "position") return isRecent(entry, now, LIMITS.keepPositionYears);
		return entry.kind === "education" || entry.kind === "certification";
	});

	const bullets: AssembledBullet[] = [];
	const bulletsFor = (entry: Entry): string[] => {
		const picks = [...(chosen.get(entry.id) ?? [])];
		// The reviewed plan is final: its bullets, in its order, with nothing added or capped.
		if (plan)
			return picks.map(({ achievement, proposed }) => {
				const chosenWording = chooseWording(achievement, proposed, mode, warnings);
				bullets.push({ achievementId: achievement.id, entryId: entry.id, ...chosenWording });
				return chosenWording.text;
			});
		// Always-include achievements join the picks (after them, unless already picked).
		for (const achievement of entry.achievements)
			if (achievement.core && !achievement.hidden && !picks.some((pick) => pick.achievement.id === achievement.id))
				picks.push({ achievement, proposed: achievement.text });
		const cap = Math.max(capFor(entry), entry.achievements.filter((a) => a.core && !a.hidden).length);
		return picks.slice(0, cap).map(({ achievement, proposed }) => {
			const wording = chooseWording(achievement, proposed, mode, warnings);
			bullets.push({ achievementId: achievement.id, entryId: entry.id, ...wording });
			return wording.text;
		});
	};

	const ofKind = (kind: Entry["kind"]) => included.filter((entry) => entry.kind === kind).toSorted(byRecency);
	const placements: Placement[] = [];
	const place = (section: Placement["section"], entry: Entry) => {
		const itemId = generateId();
		placements.push({ section, itemId, entryId: entry.id });
		return itemId;
	};
	const sections = structuredClone(base.sections);
	const section = <K extends keyof typeof sections>(key: K, items: (typeof sections)[K]["items"]) => {
		sections[key] = { ...sections[key], items, hidden: items.length === 0 ? sections[key].hidden : false } as never;
	};

	section(
		"experience",
		ofKind("position").map((entry) => ({
			id: place("experience", entry),
			hidden: false,
			company: entry.organization,
			position: entry.title,
			location: entry.location,
			period: "",
			dates: datesOf(entry),
			website: website(entry.url),
			description: bulletsHtml(bulletsFor(entry)),
			roles: [],
		})),
	);
	section(
		"projects",
		ofKind("project").map((entry) => ({
			id: place("projects", entry),
			hidden: false,
			name: entry.organization ? `${entry.title} — ${entry.organization}` : entry.title,
			period: "",
			dates: datesOf(entry),
			website: website(entry.url),
			description: bulletsHtml(bulletsFor(entry)) || paragraphHtml(entry.summary),
		})),
	);
	section(
		"volunteer",
		ofKind("volunteer").map((entry) => ({
			id: place("volunteer", entry),
			hidden: false,
			organization: entry.organization ? `${entry.organization} — ${entry.title}` : entry.title,
			location: entry.location,
			period: "",
			dates: datesOf(entry),
			website: website(entry.url),
			description: bulletsHtml(bulletsFor(entry)),
		})),
	);
	section(
		"education",
		ofKind("education").map((entry) => ({
			id: place("education", entry),
			hidden: false,
			school: entry.organization || entry.title,
			degree: entry.organization ? entry.title : "",
			area: "",
			grade: "",
			location: entry.location,
			period: "",
			dates: datesOf(entry),
			website: website(entry.url),
			description: bulletsHtml(bulletsFor(entry)),
		})),
	);
	section(
		"certifications",
		ofKind("certification").map((entry) => ({
			id: place("certifications", entry),
			hidden: false,
			title: entry.title,
			issuer: entry.organization,
			date: "",
			dates: datesOf(entry, true),
			website: website(entry.url),
			description: bulletsHtml(bulletsFor(entry)),
		})),
	);
	section(
		"awards",
		ofKind("award").map((entry) => ({
			id: place("awards", entry),
			hidden: false,
			title: entry.title,
			awarder: entry.organization,
			date: "",
			dates: datesOf(entry, true),
			website: website(entry.url),
			description: bulletsHtml(bulletsFor(entry)),
		})),
	);

	// Standalone achievements chosen by the model have no entry to sit under; they can inform the summary only.
	const standaloneChosen = chosen.get(null)?.length ?? 0;
	if (standaloneChosen > 0)
		warnings.push(
			`${standaloneChosen} selected achievement(s) aren't attached to an entry, so they weren't placed. Attach them to a position or project to use them.`,
		);

	// Skills: the model's picks first, then every other visible skill, grouped by category.
	const visibleSkills = profile.skills.filter((skill) => !skill.hidden);
	const skillById = new Map(visibleSkills.map((skill) => [skill.id, skill]));
	const pickedIds = plan
		? plan.skills.filter((skill) => skill.include).map((skill) => skill.skillId)
		: selection.skills;
	const picked = pickedIds.map((id) => skillById.get(id)).filter((skill): skill is Skill => Boolean(skill));
	// With a plan, only its skills; without, the picks first and then every other visible skill.
	const orderedSkills = plan ? [...new Set(picked)] : [...new Set([...picked, ...visibleSkills])];
	const groups = new Map<string, Skill[]>();
	for (const skill of orderedSkills) {
		const key = skill.category || "Skills";
		groups.set(key, [...(groups.get(key) ?? []), skill]);
	}
	if (input.writing) {
		const names = new Map(visibleSkills.map((skill) => [skill.id, skill.name]));
		section(
			"skills",
			input.writing.skillGroups
				.map((group) => ({
					name: group.name,
					keywords: group.skillIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
				}))
				.filter((group) => group.keywords.length > 0)
				.map((group) => ({
					id: generateId(),
					hidden: false,
					icon: "",
					iconColor: "",
					name: group.name,
					proficiency: "",
					level: 0,
					keywords: group.keywords,
				})) as never,
		);
	} else if (orderedSkills.length > 0)
		section(
			"skills",
			[...groups].map(([category, list]) => ({
				id: generateId(),
				hidden: false,
				icon: "",
				iconColor: "",
				name: category,
				proficiency: "",
				level: 0,
				keywords: list.map((skill) => skill.name),
			})) as never,
		);

	// Summary: rephrase mode only, and only when every number in it comes from what was placed.
	let summaryUsed = false;
	let summary = base.summary;
	const proposedSummary = selection.summary.trim();
	if (mode === "rephrase" && proposedSummary) {
		const placed = bullets
			.map((bullet) => visibleAchievements.get(bullet.achievementId))
			.filter(Boolean) as Achievement[];
		const sources = [
			...placed.flatMap((achievement) => [...wordingsOf(achievement), ...achievement.metrics.map((m) => m.value)]),
			...included.map((entry) => `${entry.summary} ${entry.startDate ?? ""} ${entry.endDate ?? ""}`),
			...visibleSkills.map((skill) => `${skill.name} ${skill.years ?? ""}`),
		];
		const check = checkGrounded(proposedSummary, sources, 700);
		if (check.ok) {
			summary = { ...summary, content: paragraphHtml(proposedSummary), hidden: false };
			summaryUsed = true;
		} else warnings.push(`Kept your existing summary (the suggested one ${check.reason}).`);
	}

	// Entries the model referred to that don't exist (or are hidden) are ignored, but worth knowing about.
	const unknown = plan ? 0 : selection.achievements.filter((pick) => !visibleAchievements.has(pick.id)).length;
	if (unknown > 0) warnings.push(`Ignored ${unknown} suggestion(s) that didn't match your profile.`);

	const basics = input.writing?.headline ? { ...base.basics, headline: input.writing.headline } : base.basics;
	const metadata = plan
		? { ...base.metadata, layout: orderSections(base.metadata.layout, input.writing?.sectionOrder ?? plan.sections) }
		: base.metadata;
	return {
		data: {
			...base,
			basics,
			metadata,
			summary,
			sections,
			customSections: clearAssembledCustomSections(base.customSections),
		},
		placements,
		bullets,
		entryIds: included.map((entry) => entry.id),
		skillIds: orderedSkills.map((skill) => skill.id),
		summaryUsed,
		warnings,
	};
}

/**
 * Puts the plan's sections in its recommended order within the layout's main columns, keeping each column's
 * other items and every section's column where the template put it.
 */
export function orderSections(
	layout: ResumeData["metadata"]["layout"],
	order: string[],
): ResumeData["metadata"]["layout"] {
	const rank = new Map(order.map((key, index) => [key, index]));
	return {
		...layout,
		pages: layout.pages.map((page) => {
			const slots = page.main.map((key, index) => ({ key, index })).filter(({ key }) => rank.has(key));
			const sorted = slots.map(({ key }) => key).toSorted((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
			const main = [...page.main];
			slots.forEach(({ index }, position) => {
				main[index] = sorted[position] ?? main[index] ?? "";
			});
			return { ...page, main };
		}),
	};
}
