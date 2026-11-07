import type { MasterProfile } from "../service";
import type { JobAnalysis, JobRequirement, SelectionScore } from "@reactive-resume/schema/resume-selection";
import { expand, jaccard, overlap, tokens, words } from "./text";

export type Entry = MasterProfile["entries"][number];
export type Achievement = Entry["achievements"][number];
export type Skill = MasterProfile["skills"][number];

/** Records the user has kept out of tailoring, by id, with why. */
export type Blocked = Map<string, string>;

export type Unavailable = { id: string; kind: "entry" | "achievement" | "skill"; reason: string };

/**
 * The records tailoring may use: visible in the profile, not switched off in Career Knowledge, and not made
 * private to another application. Everything else is listed as unavailable, with the reason.
 */
export function eligibleProfile(profile: MasterProfile, blocked: Blocked) {
	const unavailable: Unavailable[] = [];
	const entries: Entry[] = [];
	for (const entry of profile.entries) {
		const reason = entry.hidden ? "Hidden in your profile" : blocked.get(entry.id);
		if (reason) {
			unavailable.push({ id: entry.id, kind: "entry", reason });
			continue;
		}
		const achievements = entry.achievements.filter((achievement) => {
			const why = achievement.hidden ? "Hidden in your profile" : blocked.get(achievement.id);
			if (why) unavailable.push({ id: achievement.id, kind: "achievement", reason: why });
			return !why;
		});
		entries.push({ ...entry, achievements });
	}
	const standalone = profile.standalone.filter((achievement) => {
		const why = achievement.hidden ? "Hidden in your profile" : blocked.get(achievement.id);
		if (why) unavailable.push({ id: achievement.id, kind: "achievement", reason: why });
		return !why;
	});
	const skills = profile.skills.filter((skill) => {
		if (skill.hidden) unavailable.push({ id: skill.id, kind: "skill", reason: "Hidden in your profile" });
		return !skill.hidden;
	});
	return { profile: { entries, standalone, skills } satisfies MasterProfile, unavailable };
}

// ---- Requirements as term sets ----

export type RequirementTerms = {
	requirement: JobRequirement;
	/** Stems of the requirement and its alternative terms. */
	core: Set<string>;
	/** Core plus synonym groups and the profile's own skill aliases. */
	expanded: Set<string>;
	/** Phrases to find among an achievement's skill and theme tags. */
	phrases: Set<string>;
	/** 0–1: importance, discounted for preferred requirements. */
	weight: number;
};

const phrase = (text: string) => words(text).join(" ");

export function requirementTerms(analysis: JobAnalysis, skills: Skill[]): RequirementTerms[] {
	return analysis.requirements.map((requirement) => {
		const source = [requirement.text, ...requirement.terms].join(" ; ");
		const core = tokens(source);
		const expanded = expand(source);
		const phrases = new Set([requirement.text, ...requirement.terms].map(phrase));
		// A skill the posting names, under any of the profile's names for it, brings all of them.
		const haystack = ` ${phrase(source)} `;
		for (const skill of skills) {
			const names = [skill.name, ...skill.aliases];
			if (names.some((name) => haystack.includes(` ${phrase(name)} `)))
				for (const name of names) {
					phrases.add(phrase(name));
					for (const token of tokens(name)) expanded.add(token);
				}
		}
		const weight = (requirement.importance / 5) * (requirement.necessity === "mandatory" ? 1 : 0.75);
		return { requirement, core, expanded, phrases, weight };
	});
}

// ---- Scoring ----

const ACTION =
	/^(led|built|launched|created|designed|developed|delivered|increased|reduced|cut|grew|raised|managed|coordinated|wrote|produced|ran|organized|organised|founded|implemented|improved|negotiated|secured|redesigned|rebuilt|automated|trained|mentored|established|drove|planned|directed|oversaw|streamlined|won|published|migrated|facilitated|recruited)\b/i;
/** Requirements only a credential can meet: degrees, certifications, licences, designations. */
const CREDENTIAL =
	/\b(certif\w*|certificate|degree|diploma|licen[cs]\w*|designation|accredit\w*|bachelor\w*|master'?s|ph\.?d|mba|pmp|cpa|chrp|registered)\b/i;
const DUTY = /^(responsible for|duties|tasks|worked on|helped with|assisted with|in charge of)\b/i;

const LEVEL_WORDS: Array<[RegExp, number]> = [
	[/\b(chief|vp|vice president|executive director|ceo|cto|coo)\b/i, 6],
	[/\b(director|head of|founder|co-founder|principal|owner|partner)\b/i, 5],
	[/\b(manager|lead|supervisor|chair)\b/i, 4],
	[/\b(senior|sr\.?)\b/i, 4],
	[/\b(specialist|coordinator|developer|analyst|officer|designer|consultant|writer|engineer)\b/i, 3],
	[/\b(assistant|associate|junior|jr\.?|clerk)\b/i, 2],
	[/\b(intern|co-op|student|trainee|volunteer)\b/i, 1],
];
const JOB_LEVEL: Record<JobAnalysis["seniority"], number | null> = {
	entry: 1,
	junior: 2,
	intermediate: 3,
	senior: 4,
	lead: 4,
	manager: 4,
	executive: 6,
	unknown: null,
};

export function titleLevel(title: string): number | null {
	for (const [pattern, level] of LEVEL_WORDS) if (pattern.test(title)) return level;
	return null;
}

/** Years since the entry ended (0 for ongoing), or null without dates. */
export function yearsAgo(entry: Pick<Entry, "startDate" | "endDate"> | null, now: Date): number | null {
	if (!entry) return null;
	const date = entry.endDate ?? (entry.startDate ? null : undefined);
	if (date === undefined) return null;
	if (date === null) return 0;
	const [year, month] = date.split("-").map(Number);
	return Math.max(0, now.getFullYear() - (year ?? now.getFullYear()) + (now.getMonth() + 1 - (month ?? 6)) / 12);
}

export const recencyOf = (entry: Pick<Entry, "startDate" | "endDate"> | null, now: Date) => {
	const years = yearsAgo(entry, now);
	// Undated and standalone records sit in the middle; age alone never drops below 0.3. Work from the last few
	// years counts clearly more than work from five or more years ago.
	return years === null ? 0.6 : Math.max(0.3, 1 - years / 10);
};

/**
 * 0–1: how long the role was held, full at five years. Long roles are where most skills were built, so their
 * evidence counts for more. Projects, volunteer work and undated records sit in the middle.
 */
export const tenureOf = (entry: Pick<Entry, "kind" | "startDate" | "endDate"> | null, now: Date) => {
	if (!entry || entry.kind !== "position" || !entry.startDate) return 0.5;
	const point = (value: string) => {
		const [year, month] = value.split("-").map(Number);
		return (year ?? now.getFullYear()) + ((month ?? 6) - 1) / 12;
	};
	const end = entry.endDate ? point(entry.endDate) : now.getFullYear() + now.getMonth() / 12;
	return Math.max(0.1, Math.min(1, (end - point(entry.startDate)) / 5));
};

export type Candidate = {
	achievement: Achievement;
	entry: Entry | null;
	tokens: Set<string>;
	/** Requirement id → 0–1 strength of the match. */
	hits: Map<string, number>;
	score: SelectionScore;
};

export type RankContext = {
	analysis: JobAnalysis;
	requirements: RequirementTerms[];
	/** Stems of the user's target roles and priorities: their preferred emphasis. */
	emphasis: Set<string>;
	now: Date;
};

const achievementText = (achievement: Achievement) =>
	[
		achievement.text,
		...achievement.variants,
		...achievement.skills,
		...achievement.tags,
		...achievement.metrics.map((metric) => metric.label),
	].join(" ; ");

const entryText = (entry: Entry) => [entry.title, entry.organization, entry.summary, ...entry.tags].join(" ; ");

/** How strongly a record's text answers one requirement: 1 direct, ~0.6 by synonym, 0.25 by its entry's context. */
export function matchStrength(
	terms: RequirementTerms,
	record: Set<string>,
	tags: string[],
	context: Set<string> | null,
): number {
	if (tags.some((tag) => terms.phrases.has(phrase(tag)))) return 1;
	const direct = overlap(terms.core, record);
	if (direct >= 2) return 1;
	const related = overlap(terms.expanded, record);
	if (direct === 1) return related >= 2 ? 0.85 : 0.7;
	if (related >= 2) return 0.6;
	if (related === 1) return 0.4;
	if (context && overlap(terms.expanded, context) > 0) return 0.25;
	return 0;
}

export function scoreAchievement(achievement: Achievement, entry: Entry | null, context: RankContext): Candidate {
	const record = tokens(achievementText(achievement));
	const entryTokens = entry ? tokens(entryText(entry)) : null;
	const tags = [...achievement.skills, ...achievement.tags];
	const hits = new Map<string, number>();
	const contributions: number[] = [];
	for (const terms of context.requirements) {
		const raw = matchStrength(terms, record, tags, entryTokens);
		// An achievement can relate to a credential or degree but can't prove one; the credential itself does.
		const hit = CREDENTIAL.test(terms.requirement.text) ? Math.min(raw, 0.5) : raw;
		if (hit > 0) hits.set(terms.requirement.id, hit);
		contributions.push(hit * terms.weight);
	}
	const alignment = alignmentOf(contributions);

	const text = achievement.text.trim();
	const measured = achievement.metrics.length > 0 || /\d/.test(text);
	const strength = Math.max(
		0,
		Math.min(
			1,
			0.35 +
				(measured ? 0.3 : 0) +
				(ACTION.test(text) ? 0.15 : 0) +
				(text.length >= 60 && text.length <= 280 ? 0.1 : 0) +
				(achievement.core ? 0.1 : 0) -
				(DUTY.test(text) ? 0.2 : 0),
		),
	);
	const recency = recencyOf(entry, context.now);
	const jobLevel = JOB_LEVEL[context.analysis.seniority];
	const level = entry ? titleLevel(entry.title) : null;
	const scope = jobLevel === null || level === null ? 0.7 : 1 - Math.min(1, Math.abs(jobLevel - level) * 0.25);
	const emphasis =
		overlap(context.emphasis, record) > 0 || (entryTokens && overlap(context.emphasis, entryTokens) > 0) ? 1 : 0;
	const tenure = tenureOf(entry, context.now);
	// Relevance leads; recent and long-held roles, where the candidate built most of their experience, come next.
	const total = 0.5 * alignment + 0.18 * strength + 0.14 * recency + 0.08 * tenure + 0.04 * emphasis + 0.06 * scope;
	return {
		achievement,
		entry,
		tokens: record,
		hits,
		score: {
			total: round(total),
			alignment: round(alignment),
			strength: round(strength),
			recency: round(recency),
			tenure: round(tenure),
			aiRelevance: null,
		},
	};
}

/**
 * 0–1: led by the single best weighted match, with smaller credit for a second and third, so many weak,
 * incidental matches can't add up to look like one strong one.
 */
export function alignmentOf(contributions: number[]) {
	const [first = 0, second = 0, third = 0] = contributions.toSorted((a, b) => b - a);
	return Math.min(1, first + 0.35 * second + 0.15 * third);
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function rankEvidence(profile: MasterProfile, context: RankContext): Candidate[] {
	const candidates: Candidate[] = [];
	for (const entry of profile.entries)
		for (const achievement of entry.achievements) candidates.push(scoreAchievement(achievement, entry, context));
	for (const achievement of profile.standalone) candidates.push(scoreAchievement(achievement, null, context));
	// Ties break on the profile's own order, so the same input always ranks the same way.
	return candidates
		.map((candidate, index) => ({ candidate, index }))
		.toSorted((a, b) => b.candidate.score.total - a.candidate.score.total || a.index - b.index)
		.map(({ candidate }) => candidate);
}

/** How well an entry's own title, scope and tags answer the requirements (for entries without achievements). */
export function entryAlignment(entry: Entry, context: RankContext): { alignment: number; requirementIds: string[] } {
	const record = tokens(entryText(entry));
	const contributions: number[] = [];
	const requirementIds: string[] = [];
	for (const terms of context.requirements) {
		const hit = matchStrength(terms, record, entry.tags, null);
		if (hit >= 0.6) requirementIds.push(terms.requirement.id);
		contributions.push(hit * terms.weight);
	}
	return { alignment: round(alignmentOf(contributions)), requirementIds };
}

export const SHORTLIST = {
	/** Best overall. */
	top: 50,
	/** Best per requirement, so every requirement's strongest evidence is seen. */
	perRequirement: 4,
	/** Characters of record text sent to the AI. */
	budget: 36_000,
};

/**
 * The achievements the AI reviews: the best overall, the best for each requirement, every always-include
 * achievement and each entry's best, within a size budget. The full record is ranked first, so evidence deep in a
 * large profile is still found; the AI is told how many weaker records weren't sent.
 */
export function shortlist(ranked: Candidate[], requirements: RequirementTerms[]): Candidate[] {
	const wanted: Candidate[] = [];
	const add = (candidate: Candidate | undefined) => {
		if (candidate && !wanted.includes(candidate)) wanted.push(candidate);
	};
	for (const candidate of ranked.slice(0, SHORTLIST.top)) add(candidate);
	for (const terms of requirements)
		ranked
			.filter((candidate) => (candidate.hits.get(terms.requirement.id) ?? 0) >= 0.4)
			.toSorted(
				(a, b) =>
					(b.hits.get(terms.requirement.id) ?? 0) * b.score.total -
					(a.hits.get(terms.requirement.id) ?? 0) * a.score.total,
			)
			.slice(0, SHORTLIST.perRequirement)
			.forEach(add);
	for (const candidate of ranked) if (candidate.achievement.core) add(candidate);
	const bestOfEntry = new Set<string>();
	for (const candidate of ranked) {
		const key = candidate.entry?.id ?? "standalone";
		if (bestOfEntry.has(key)) continue;
		bestOfEntry.add(key);
		add(candidate);
	}

	let used = 0;
	return wanted.filter((candidate) => {
		used += candidate.achievement.text.length + 80;
		return used <= SHORTLIST.budget;
	});
}

/** Near-identical achievements, which usually mean a duplicate record. */
export function similar(a: Candidate, b: Candidate) {
	return jaccard(a.tokens, b.tokens);
}
