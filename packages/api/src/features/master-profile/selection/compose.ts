import type { MasterProfile } from "../service";
import type { Candidate, Entry, RankContext, Skill, Unavailable } from "./rank";
import type { Review } from "./review";
import type {
	JobAnalysis,
	PlanAchievement,
	PlanEntry,
	PlanSkill,
	RequirementCoverage,
	ResumeSelectionPlan,
	SelectionEdit,
	SelectionSection,
} from "@reactive-resume/schema/resume-selection";
import { entryAlignment, matchStrength, similar, yearsAgo } from "./rank";
import { tokens, words } from "./text";

/** Configurable defaults for what a tailored resume includes. */
export const SELECTION_RULES = {
	/** Combined score an achievement needs to be recommended. */
	threshold: 0.45,
	/** And some real connection to the posting: a strong, recent but unrelated achievement isn't recommended. */
	minAlignment: 0.35,
	/** Bullets for the most recent included position, other recent positions, older ones, and anything else. */
	bullets: { lead: 5, recent: 4, older: 3, other: 3 },
	/** Positions ending within this many years count as recent. */
	recentYears: 10,
	/** The current or latest position stays on the resume for its timeline, unless the user removes it. */
	keepCurrentYears: 2,
	maxPositions: 6,
	maxProjects: 3,
	maxVolunteer: 2,
	/** An older position joins when one of its achievements scores at least this, even without unique coverage. */
	strongOlder: 0.72,
	/** Two achievements this similar are treated as saying the same thing. */
	redundant: 0.55,
	maxSkills: 15,
};

const R = SELECTION_RULES;

/** Worth recommending: above the threshold and connected to the posting (by the ranking or the AI). */
const recommended = (item: PlanAchievement) =>
	item.score.total >= R.threshold && (item.score.alignment >= R.minAlignment || (item.score.aiRelevance ?? 0) >= 2);

/** The AI's rating blended with the ranking: half each, so neither alone decides. */
function blend(candidate: Candidate, review: Review): PlanAchievement["score"] {
	const ai = review.achievements.get(candidate.achievement.id);
	if (!ai) return candidate.score;
	return {
		...candidate.score,
		total: Math.round((0.5 * (ai.relevance / 3) + 0.5 * candidate.score.total) * 1000) / 1000,
		aiRelevance: ai.relevance,
	};
}

function requirementIdsOf(candidate: Candidate, review: Review): string[] {
	const fromRanking = [...candidate.hits.entries()].filter(([, hit]) => hit >= 0.6).map(([id]) => id);
	const fromAi = review.achievements.get(candidate.achievement.id)?.requirementIds ?? [];
	return sortRequirementIds([...new Set([...fromAi, ...fromRanking])]);
}

const sortRequirementIds = (ids: string[]) => ids.toSorted((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

function describe(score: PlanAchievement["score"], requirementIds: string[], analysis: JobAnalysis, aiReason: string) {
	if (aiReason) return aiReason;
	const names = requirementIds
		.slice(0, 2)
		.map((id) => analysis.requirements.find((requirement) => requirement.id === id)?.text)
		.filter(Boolean);
	if (names.length > 0) return `Evidence for ${names.join(" and ")}`;
	return score.alignment < 0.2 ? "Little connection to this posting" : "Some connection to this posting";
}

export type ComposeInput = {
	applicationId: string;
	analysis: JobAnalysis;
	profile: MasterProfile;
	unavailable: Unavailable[];
	ranked: Candidate[];
	review: Review;
	source: ResumeSelectionPlan["source"];
	context: RankContext;
	/** The previous plan: the user's edits in it carry over to records that still exist. */
	previous?: ResumeSelectionPlan | null | undefined;
	now?: Date;
};

/** Ongoing first, then latest end, then latest start: reverse chronological order. */
export function byRecency(a: Pick<Entry, "startDate" | "endDate">, b: Pick<Entry, "startDate" | "endDate">) {
	const end = (entry: Pick<Entry, "startDate" | "endDate">) => entry.endDate ?? (entry.startDate ? "9999" : "0000");
	return end(b).localeCompare(end(a)) || (b.startDate ?? "").localeCompare(a.startDate ?? "");
}

/**
 * The Resume Selection Plan, decided by rules over the ranking and the AI's review: which entries and
 * achievements to include, in what order, with how many bullets, and why. Everything in the eligible record
 * appears, so the plan shows the full record and the subset chosen from it.
 */
export function composePlan(input: ComposeInput): ResumeSelectionPlan {
	const { analysis, profile, review, context } = input;
	const now = input.now ?? context.now;
	const candidates = new Map(input.ranked.map((candidate) => [candidate.achievement.id, candidate]));

	const planAchievement = (candidate: Candidate): PlanAchievement => {
		const score = blend(candidate, review);
		const requirementIds = requirementIdsOf(candidate, review);
		return {
			achievementId: candidate.achievement.id,
			text: candidate.achievement.text,
			include: false,
			requirementIds,
			reason: describe(
				score,
				requirementIds,
				analysis,
				review.achievements.get(candidate.achievement.id)?.reason ?? "",
			),
			score,
			userEdited: false,
			core: candidate.achievement.core,
		};
	};

	// Entries in reverse chronological order, each with its achievements best first.
	const ordered = profile.entries.toSorted(byRecency);
	const entries: PlanEntry[] = ordered.map((entry) => {
		const achievements = entry.achievements
			.map((achievement) => candidates.get(achievement.id))
			.filter((candidate): candidate is Candidate => Boolean(candidate))
			.map(planAchievement)
			.toSorted((a, b) => b.score.total - a.score.total);
		return {
			entryId: entry.id,
			kind: entry.kind,
			title: entry.title,
			organization: entry.organization,
			startDate: entry.startDate,
			endDate: entry.endDate,
			include: false,
			reason: "",
			bulletTarget: 0,
			requirementIds: entryAlignment(entry, context).requirementIds,
			achievements,
			userEdited: false,
		};
	});
	const entryById = new Map(profile.entries.map((entry) => [entry.id, entry]));

	// Choose bullets across the whole resume, best first, skipping near-duplicates of something already chosen.
	const chosen: PlanAchievement[] = [];
	const covered = new Map<string, number>();
	const chooseIn = (plan: PlanEntry, cap: number) => {
		const picks: PlanAchievement[] = [];
		for (const item of plan.achievements) {
			if (picks.length >= cap && !item.core) continue;
			if (!item.core && !recommended(item)) continue;
			const candidate = candidates.get(item.achievementId);
			const twin =
				candidate &&
				chosen.find((other) => {
					const otherCandidate = candidates.get(other.achievementId);
					return otherCandidate ? similar(candidate, otherCandidate) >= R.redundant : false;
				});
			if (twin && !item.core) {
				item.reason = `Says much the same as a stronger achievement already included`;
				continue;
			}
			picks.push(item);
		}
		for (const item of picks) {
			item.include = true;
			chosen.push(item);
			for (const id of item.requirementIds) covered.set(id, Math.max(covered.get(id) ?? 0, item.score.total));
		}
		// Included first, in score order; the rest after, best first.
		plan.achievements = [...picks, ...plan.achievements.filter((item) => !picks.includes(item))];
		plan.bulletTarget = picks.length;
		return picks;
	};

	const best = (plan: PlanEntry) => plan.achievements[0]?.score.total ?? 0;
	const aiEntry = (plan: PlanEntry) => review.entries.get(plan.entryId);

	// Positions: recent ones decide first, then older ones join only with evidence the recent ones lack.
	let positions = 0;
	let lead = true;
	for (const plan of entries.filter((item) => item.kind === "position")) {
		const entry = entryById.get(plan.entryId);
		if (!entry) continue;
		const age = yearsAgo(entry, now);
		const recent = age === null || age <= R.recentYears;
		const ai = aiEntry(plan);
		const strong = best(plan) >= R.threshold;
		const current = age !== null && age <= R.keepCurrentYears && positions === 0;
		let include: boolean;
		let reason: string;
		if (positions >= R.maxPositions) {
			include = false;
			reason = "Enough stronger positions are already included";
		} else if (recent) {
			include = (ai ? ai.include : strong) || current || (strong && ai?.include !== false);
			reason = include
				? current && !strong
					? "Your current or latest role, kept so your timeline is clear"
					: ai?.reason || "Recent, relevant experience"
				: ai?.reason || "Little evidence for this posting";
		} else {
			const unique = plan.achievements.some(
				(item) =>
					item.score.total >= R.threshold &&
					item.requirementIds.some((id) => (covered.get(id) ?? 0) < Math.max(R.threshold, item.score.total - 0.1)),
			);
			include = ai?.include !== false && (best(plan) >= R.strongOlder || unique);
			reason = include
				? best(plan) >= R.strongOlder
					? "Older, but strongly relevant"
					: "Older, and shows something your recent roles don't"
				: ai?.include === false
					? ai.reason || "Older and not needed for this posting"
					: "Older; your recent roles already show this";
		}
		plan.include = include;
		plan.reason = reason;
		if (!include) continue;
		positions++;
		const cap = lead ? R.bullets.lead : recent ? R.bullets.recent : R.bullets.older;
		lead = false;
		const picks = chooseIn(plan, cap);
		// A kept position with nothing above the threshold still shows its best bullet, if it has one.
		if (picks.length === 0 && plan.achievements[0]) {
			plan.achievements[0].include = true;
			plan.bulletTarget = 1;
		}
	}

	// Projects and volunteer roles: by strength, a few of each.
	for (const [kind, max] of [
		["project", R.maxProjects],
		["volunteer", R.maxVolunteer],
	] as const) {
		const list = entries.filter((item) => item.kind === kind).toSorted((a, b) => best(b) - best(a));
		let count = 0;
		for (const plan of list) {
			const ai = aiEntry(plan);
			const entry = entryById.get(plan.entryId);
			const ownAlignment = entry && plan.achievements.length === 0 ? entryAlignment(entry, context).alignment : 0;
			const strong = best(plan) >= R.threshold || ownAlignment >= R.threshold;
			plan.include = count < max && (ai ? ai.include && (strong || best(plan) > 0.3) : strong);
			plan.reason = plan.include
				? ai?.reason || (kind === "project" ? "Relevant project" : "Relevant volunteer work")
				: ai?.reason || (count >= max ? "Stronger ones are already included" : "Little evidence for this posting");
			if (!plan.include) continue;
			count++;
			chooseIn(plan, R.bullets.other);
		}
	}

	// Education is listed by convention; certifications and awards when they relate to the posting or are recent.
	for (const plan of entries.filter((item) => ["education", "certification", "award"].includes(item.kind))) {
		const entry = entryById.get(plan.entryId);
		if (!entry) continue;
		const { alignment, requirementIds } = entryAlignment(entry, context);
		const ai = aiEntry(plan);
		if (plan.kind === "education") {
			plan.include = ai?.include ?? true;
			plan.reason = plan.include ? "Education is listed on most resumes" : ai?.reason || "Left out";
		} else {
			const recent = (yearsAgo(entry, now) ?? 99) <= 5;
			plan.include = ai
				? ai.include
				: alignment >= 0.3 || requirementIds.length > 0 || (plan.kind === "certification" && recent);
			plan.reason = plan.include
				? ai?.reason || (requirementIds.length > 0 ? "Relates to the posting's requirements" : "A recent credential")
				: ai?.reason || "Not related to this posting";
		}
		if (plan.include) chooseIn(plan, R.bullets.other);
		for (const id of requirementIds) if (plan.include) covered.set(id, Math.max(covered.get(id) ?? 0, 0.5));
	}

	for (const plan of entries) if (!plan.include && !plan.reason) plan.reason = "Not chosen for this posting";

	const standalone = profile.standalone
		.map((achievement) => candidates.get(achievement.id))
		.filter((candidate): candidate is Candidate => Boolean(candidate))
		.map((candidate) => ({
			...planAchievement(candidate),
			reason: "Not attached to an entry, so it can't be placed as a bullet",
		}))
		.toSorted((a, b) => b.score.total - a.score.total);

	const skills = chooseSkills(profile.skills, entries, review, context);

	let plan: ResumeSelectionPlan = {
		version: 1,
		applicationId: input.applicationId,
		createdAt: now.toISOString(),
		source: input.source,
		positioning: review.positioning,
		sections: [],
		usage: [],
		entries,
		standalone,
		skills,
		coverage: [],
		unavailable: input.unavailable,
		warnings: sourceWarnings(profile, input.ranked),
		totals: { entries: 0, achievements: 0, skills: 0, includedEntries: 0, includedAchievements: 0, includedSkills: 0 },
	};
	if (input.previous) plan = carryEdits(plan, input.previous);
	return finalize(plan, analysis);
}

/** Skills that relate to a requirement, best evidenced first; listed only when they relate to this posting. */
function chooseSkills(skills: Skill[], entries: PlanEntry[], review: Review, context: RankContext): PlanSkill[] {
	const shown = new Set<string>();
	for (const plan of entries)
		for (const item of plan.achievements) if (item.include) for (const token of tokens(item.text)) shown.add(token);
	const scored = skills.map((skill, index) => {
		const names = [skill.name, ...skill.aliases];
		const record = tokens(names.join(" ; "));
		const requirementIds = context.requirements
			.filter((terms) => matchStrength(terms, record, names, null) >= 0.7)
			.map((terms) => terms.requirement.id);
		const ai = review.skills.get(skill.id);
		const ids = sortRequirementIds([...new Set([...(ai?.requirementIds ?? []), ...requirementIds])]);
		const evidenced = names.some((name) => {
			const nameTokens = tokens(name);
			return nameTokens.size > 0 && [...nameTokens].every((token) => shown.has(token));
		});
		const weight = ids.reduce(
			(sum, id) => sum + (context.requirements.find((terms) => terms.requirement.id === id)?.weight ?? 0),
			0,
		);
		const value = (ai ? ai.relevance / 3 : 0) * 0.5 + Math.min(1, weight) * 0.35 + (evidenced ? 0.15 : 0);
		return { skill, ids, evidenced, ai, value, index };
	});
	const ranked = scored.toSorted((a, b) => b.value - a.value || a.index - b.index);
	let count = 0;
	return ranked.map(({ skill, ids, evidenced, ai, value }) => {
		const include = count < R.maxSkills && ((ai?.relevance ?? 0) >= 2 || (ids.length > 0 && value >= 0.25));
		if (include) count++;
		return {
			skillId: skill.id,
			name: skill.name,
			category: skill.category,
			include,
			requirementIds: ids,
			evidenced,
			reason: include
				? evidenced
					? "Relevant, and shown by an included achievement"
					: "Relevant to the posting"
				: ids.length > 0
					? "Relevant, but stronger skills fill the list"
					: "Not asked for in this posting",
			userEdited: false,
		};
	});
}

/** Incomplete or conflicting records worth checking before relying on them. */
function sourceWarnings(profile: MasterProfile, ranked: Candidate[]): string[] {
	const warnings: string[] = [];
	for (const entry of profile.entries) {
		if (entry.kind === "position" && !entry.startDate)
			warnings.push(
				`"${entry.title}${entry.organization ? ` at ${entry.organization}` : ""}" has no start date, so its place in your timeline is a guess.`,
			);
	}
	const seen = new Map<string, Entry>();
	for (const entry of profile.entries) {
		const key = `${entry.kind}|${words(entry.title).join(" ")}|${words(entry.organization).join(" ")}`;
		const twin = seen.get(key);
		if (twin && (twin.startDate !== entry.startDate || twin.endDate !== entry.endDate))
			warnings.push(
				`"${entry.title}${entry.organization ? ` at ${entry.organization}` : ""}" appears twice with different dates (${twin.startDate ?? "?"}–${twin.endDate ?? "present"} and ${entry.startDate ?? "?"}–${entry.endDate ?? "present"}). Check which is right.`,
			);
		else seen.set(key, entry);
	}
	const reported = new Set<string>();
	for (let i = 0; i < ranked.length; i++)
		for (let j = i + 1; j < ranked.length; j++) {
			const a = ranked[i];
			const b = ranked[j];
			if (!a || !b || reported.has(a.achievement.id) || reported.has(b.achievement.id)) continue;
			if (similar(a, b) >= 0.85) {
				reported.add(b.achievement.id);
				warnings.push(
					`Two achievements read almost the same: "${clip(a.achievement.text)}" and "${clip(b.achievement.text)}".`,
				);
			}
		}
	const names = new Map<string, string>();
	for (const skill of profile.skills)
		for (const name of [skill.name, ...skill.aliases]) {
			const key = name.toLowerCase().trim();
			const other = names.get(key);
			if (other && other !== skill.name) warnings.push(`"${name}" names two skills (${other} and ${skill.name}).`);
			else names.set(key, skill.name);
		}
	return warnings.slice(0, 20);
}

const clip = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Re-applies the user's earlier include/exclude and order choices to a fresh plan. */
function carryEdits(plan: ResumeSelectionPlan, previous: ResumeSelectionPlan): ResumeSelectionPlan {
	const oldEntries = new Map(previous.entries.map((entry) => [entry.entryId, entry]));
	for (const entry of plan.entries) {
		const old = oldEntries.get(entry.entryId);
		if (!old) continue;
		if (old.userEdited) {
			entry.include = old.include;
			entry.userEdited = true;
		}
		const edited = old.achievements.filter((item) => item.userEdited);
		if (edited.length === 0) continue;
		const byId = new Map(entry.achievements.map((item) => [item.achievementId, item]));
		for (const item of edited) {
			const now = byId.get(item.achievementId);
			if (!now) continue;
			now.include = item.include;
			now.userEdited = true;
		}
		// Keep the user's order for achievements they arranged; new ones follow.
		const order = old.achievements.map((item) => item.achievementId);
		entry.achievements = entry.achievements.toSorted((a, b) => {
			const ia = order.indexOf(a.achievementId);
			const ib = order.indexOf(b.achievementId);
			if (ia === -1 || ib === -1) return Number(ia === -1) - Number(ib === -1);
			return ia - ib;
		});
	}
	const oldSkills = new Map(previous.skills.map((skill) => [skill.skillId, skill]));
	for (const skill of plan.skills) {
		const old = oldSkills.get(skill.skillId);
		if (old?.userEdited) {
			skill.include = old.include;
			skill.userEdited = true;
		}
	}
	return plan;
}

/** Coverage, section order and totals: everything derived from include flags, recomputed after every edit. */
export function finalize(plan: ResumeSelectionPlan, analysis: JobAnalysis): ResumeSelectionPlan {
	for (const entry of plan.entries) {
		const included = entry.achievements.filter((item) => item.include);
		// Included achievements print first, in the order given.
		entry.achievements = [...included, ...entry.achievements.filter((item) => !item.include)];
		entry.bulletTarget = entry.include ? included.length : 0;
	}
	const includedEntries = plan.entries.filter((entry) => entry.include);
	const includedAchievements = includedEntries.flatMap((entry) => entry.achievements.filter((item) => item.include));
	const allAchievements = [...plan.entries.flatMap((entry) => entry.achievements), ...plan.standalone];
	const includedSkills = plan.skills.filter((skill) => skill.include);

	const coverage: RequirementCoverage[] = analysis.requirements.map((requirement) => {
		const strong = includedAchievements.filter(
			(item) => item.requirementIds.includes(requirement.id) && (item.score.aiRelevance ?? 2) >= 2,
		);
		const weak = includedAchievements.filter(
			(item) => item.requirementIds.includes(requirement.id) && !strong.includes(item),
		);
		const skills = includedSkills.filter((skill) => skill.requirementIds.includes(requirement.id));
		const credentials = includedEntries.filter((entry) => entry.requirementIds.includes(requirement.id));
		const available = allAchievements
			.filter((item) => !includedAchievements.includes(item) && item.requirementIds.includes(requirement.id))
			.map((item) => item.achievementId);
		return {
			requirementId: requirement.id,
			status:
				strong.length > 0
					? "supported"
					: weak.length > 0 || skills.length > 0 || credentials.length > 0
						? "partial"
						: "gap",
			achievementIds: [...strong, ...weak].map((item) => item.achievementId),
			skillIds: skills.map((skill) => skill.skillId),
			entryIds: credentials.map((entry) => entry.entryId),
			available,
		};
	});

	const has = (kind: PlanEntry["kind"]) => includedEntries.some((entry) => entry.kind === kind);
	const bestOf = (kind: PlanEntry["kind"]) =>
		Math.max(
			0,
			...includedEntries
				.filter((entry) => entry.kind === kind)
				.flatMap((entry) => entry.achievements.filter((item) => item.include).map((item) => item.score.total)),
		);
	const sections: SelectionSection[] = ["summary"];
	if (includedSkills.length > 0) sections.push("skills");
	// Projects lead when they carry the strongest evidence (common for technical and early-career resumes).
	if (has("project") && bestOf("project") > bestOf("position")) sections.push("projects", "experience");
	else sections.push("experience", ...(has("project") ? (["projects"] as const) : []));
	if (has("volunteer")) sections.push("volunteer");
	if (has("education")) sections.push("education");
	if (has("certification")) sections.push("certifications");
	if (has("award")) sections.push("awards");

	return {
		...plan,
		sections,
		coverage,
		totals: {
			entries: plan.entries.length,
			achievements: allAchievements.length,
			skills: plan.skills.length,
			includedEntries: includedEntries.length,
			includedAchievements: includedAchievements.length,
			includedSkills: includedSkills.length,
		},
	};
}

/**
 * Applies the user's review to the stored plan: include flags and order only. Records never change, and ids
 * that aren't in the plan are ignored. Anything that differs from the proposal is marked as the user's choice.
 */
export function applyEdit(
	plan: ResumeSelectionPlan,
	proposed: ResumeSelectionPlan,
	edit: SelectionEdit,
	analysis: JobAnalysis,
) {
	const next = structuredClone(plan);
	const proposedEntries = new Map(proposed.entries.map((entry) => [entry.entryId, entry]));
	const edits = new Map(edit.entries.map((entry) => [entry.entryId, entry]));
	for (const entry of next.entries) {
		const change = edits.get(entry.entryId);
		if (!change) continue;
		const original = proposedEntries.get(entry.entryId);
		entry.include = change.include;
		entry.userEdited = original ? original.include !== change.include : true;
		const byId = new Map(entry.achievements.map((item) => [item.achievementId, item]));
		const originalOrder = original?.achievements.filter((item) => item.include).map((item) => item.achievementId) ?? [];
		const ordered: PlanAchievement[] = [];
		for (const item of change.achievements) {
			const current = byId.get(item.achievementId);
			if (!current || ordered.includes(current)) continue;
			current.include = item.include;
			ordered.push(current);
		}
		for (const item of entry.achievements) if (!ordered.includes(item)) ordered.push(item);
		const includedOrder = ordered.filter((item) => item.include).map((item) => item.achievementId);
		const reordered = includedOrder.join() !== originalOrder.join();
		const originalById = new Map(original?.achievements.map((item) => [item.achievementId, item]) ?? []);
		for (const item of ordered)
			item.userEdited =
				(originalById.get(item.achievementId)?.include ?? false) !== item.include || (reordered && item.include);
		entry.achievements = ordered;
	}
	const skillEdits = new Map(edit.skills.map((skill) => [skill.skillId, skill.include]));
	const proposedSkills = new Map(proposed.skills.map((skill) => [skill.skillId, skill.include]));
	for (const skill of next.skills) {
		const include = skillEdits.get(skill.skillId);
		if (include === undefined) continue;
		skill.include = include;
		skill.userEdited = proposedSkills.get(skill.skillId) !== include;
	}
	return finalize(next, analysis);
}
