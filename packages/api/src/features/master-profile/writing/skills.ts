import type { MasterProfile } from "../service";
import type { ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import type { SkillGroup, WritingRules } from "@reactive-resume/schema/resume-writing";
import { words } from "../selection/text";

type Skill = MasterProfile["skills"][number];

/**
 * Generic soft skills. On a resume they're shown by accomplishments, not listed; they're kept only when the user
 * included one on purpose.
 */
const SOFT_SKILLS = new Set(
	[
		"communication",
		"communication skills",
		"communications skills",
		"teamwork",
		"team player",
		"collaboration",
		"leadership",
		"problem solving",
		"problem-solving",
		"critical thinking",
		"time management",
		"organization",
		"organizational skills",
		"attention to detail",
		"detail oriented",
		"detail-oriented",
		"adaptability",
		"flexibility",
		"work ethic",
		"interpersonal skills",
		"self-motivated",
		"multitasking",
		"creativity",
		"customer service",
		"hard working",
		"hardworking",
	].map((name) => words(name).join(" ")),
);

const key = (name: string) => words(name).join(" ");
export const isSoftSkill = (name: string) => SOFT_SKILLS.has(key(name));

const namesOf = (skill: Skill) => [skill.name, ...skill.aliases].map(key).filter(Boolean);

/** A skill is evidenced when an included achievement names it, as a tag or in its text. */
export function evidencedSkills(profile: MasterProfile, plan: ResumeSelectionPlan): Set<string> {
	const included = new Set(
		plan.entries
			.filter((entry) => entry.include)
			.flatMap((entry) => entry.achievements.filter((item) => item.include).map((item) => item.achievementId)),
	);
	const records = profile.entries
		.flatMap((entry) => entry.achievements)
		.filter((achievement) => included.has(achievement.id));
	const tags = new Set(records.flatMap((achievement) => achievement.skills.map(key)));
	const text = ` ${records.map((achievement) => words(achievement.text).join(" ")).join(" | ")} `;
	const evidenced = new Set<string>();
	for (const skill of profile.skills)
		if (namesOf(skill).some((name) => tags.has(name) || text.includes(` ${name} `))) evidenced.add(skill.id);
	return evidenced;
}

/** One skill says the same as another: a shared name or alias, or one name contained in the other's. */
function overlaps(a: Skill, b: Skill) {
	const an = namesOf(a);
	const bn = namesOf(b);
	return an.some((x) => bn.some((y) => x === y || ` ${y} `.includes(` ${x} `) || ` ${x} `.includes(` ${y} `)));
}

export type ChosenSkills = {
	skills: Skill[];
	leftOut: Array<{ skillId: string; name: string; reason: string }>;
};

/**
 * The skills to list: what the user included, then relevant skills their included achievements show, then other
 * relevant ones, then other evidenced ones until the minimum is met; never past the maximum. Overlapping names
 * keep the first, and generic soft skills are left to the accomplishments unless the user chose them.
 */
export function chooseSkills(profile: MasterProfile, plan: ResumeSelectionPlan, rules: WritingRules): ChosenSkills {
	const byId = new Map(profile.skills.map((skill) => [skill.id, skill]));
	const evidenced = evidencedSkills(profile, plan);
	const leftOut: ChosenSkills["leftOut"] = [];
	const tiers: Array<[number, (item: ResumeSelectionPlan["skills"][number]) => boolean]> = [
		[0, (item) => item.include && item.userEdited],
		[1, (item) => item.include && evidenced.has(item.skillId)],
		[2, (item) => item.include],
		[3, (item) => !item.userEdited && item.requirementIds.length > 0 && evidenced.has(item.skillId)],
		[4, (item) => !item.userEdited && evidenced.has(item.skillId)],
	];
	const ordered: Array<{ item: ResumeSelectionPlan["skills"][number]; tier: number }> = [];
	for (const item of plan.skills) {
		const tier = tiers.find(([, test]) => test(item))?.[0];
		if (tier !== undefined) ordered.push({ item, tier });
		else if (!item.include && item.userEdited)
			leftOut.push({ skillId: item.skillId, name: item.name, reason: "You left it out" });
	}
	ordered.sort((a, b) => a.tier - b.tier);

	const chosen: Skill[] = [];
	for (const { item, tier } of ordered) {
		const skill = byId.get(item.skillId);
		if (!skill || skill.hidden) continue;
		if (tier >= 3 && chosen.length >= rules.skills.min) continue;
		if (isSoftSkill(skill.name) && tier !== 0) {
			leftOut.push({
				skillId: skill.id,
				name: skill.name,
				reason: "A soft skill: shown through your achievements instead",
			});
			continue;
		}
		const twin = chosen.find((other) => overlaps(other, skill));
		if (twin) {
			leftOut.push({ skillId: skill.id, name: skill.name, reason: `Overlaps with ${twin.name}` });
			continue;
		}
		if (chosen.length >= rules.skills.max) {
			leftOut.push({ skillId: skill.id, name: skill.name, reason: `The list already has ${rules.skills.max} skills` });
			continue;
		}
		chosen.push(skill);
	}
	return { skills: chosen, leftOut };
}

const GENERIC_GROUP = /^(skills?|other|misc(ellaneous)?|general|technical skills|soft skills|keywords?)$/i;

/**
 * Groups proposed by the AI, checked: every chosen skill exactly once, 2–4 groups (as configured), names short
 * and specific. Returns null when they don't hold, so the profile's own categories are used instead.
 */
export function validateGroups(proposed: SkillGroup[], skills: Skill[], rules: WritingRules): SkillGroup[] | null {
	const ids = new Set(skills.map((skill) => skill.id));
	const seen = new Set<string>();
	const groups: SkillGroup[] = [];
	for (const group of proposed) {
		const name = group.name.trim().replace(/\s+/g, " ");
		if (!name || name.length > 40 || GENERIC_GROUP.test(name)) return null;
		const members = group.skillIds.filter((id) => ids.has(id) && !seen.has(id));
		for (const id of members) seen.add(id);
		if (members.length > 0) groups.push({ name, skillIds: members });
	}
	if (groups.length === 0) return null;
	// Skills the AI forgot join the first group rather than vanishing.
	const missing = skills.filter((skill) => !seen.has(skill.id)).map((skill) => skill.id);
	if (missing.length > skills.length / 3) return null;
	if (missing.length > 0) groups[0]?.skillIds.push(...missing);
	const enough = skills.length < rules.skills.minGroups * 2 || groups.length >= rules.skills.minGroups;
	return enough && groups.length <= rules.skills.maxGroups ? groups : null;
}

/** Groups from the profile's own categories: largest first, the smallest merged once there are too many. */
export function groupByCategory(skills: Skill[], rules: WritingRules): SkillGroup[] {
	const categories = new Map<string, string[]>();
	for (const skill of skills) {
		const name = skill.category.trim() || "Additional skills";
		categories.set(name, [...(categories.get(name) ?? []), skill.id]);
	}
	const groups = [...categories]
		.map(([name, skillIds]) => ({ name, skillIds }))
		.toSorted((a, b) => b.skillIds.length - a.skillIds.length);
	if (groups.length <= rules.skills.maxGroups) return groups;
	const kept = groups.slice(0, rules.skills.maxGroups - 1);
	const rest = groups.slice(rules.skills.maxGroups - 1).flatMap((group) => group.skillIds);
	return [
		...kept,
		{
			name: kept.some((group) => group.name === "Additional skills") ? "Other skills" : "Additional skills",
			skillIds: rest,
		},
	];
}
