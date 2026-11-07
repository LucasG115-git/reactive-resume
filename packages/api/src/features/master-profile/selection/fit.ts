import type { MasterProfile } from "../service";
import type { JobAnalysis, ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import type { WritingRules } from "@reactive-resume/schema/resume-writing";
import { experienceYears } from "../writing/checks";
import { finalize } from "./compose";
import { words } from "./text";

/**
 * Fits a proposed selection to the page target: while the estimated length is over it, the weakest proposed
 * achievement is left out (never one the user chose or marked always-include); the lead role keeps up to three bullets
 * and other positions one. Then whole projects or volunteer roles go, weakest first. Everything left out says why, so the user
 * can include it again in review; nothing is changed in the profile.
 */

/** Words a resume of this plan will print, estimated the way the length check does. */
export function estimateWords(plan: ResumeSelectionPlan, rules: WritingRules) {
	const entries = plan.entries.filter((entry) => entry.include);
	const bullets = entries.flatMap((entry) => entry.achievements.filter((item) => item.include));
	const bulletWords = bullets.reduce((sum, item) => sum + Math.min(words(item.text).length, rules.bullets.maxWords), 0);
	const skills = Math.min(plan.skills.filter((skill) => skill.include).length, rules.skills.max);
	const header = 30;
	const summary = rules.summary.enabled ? rules.summary.maxWords : 0;
	return header + summary + skills * 2.5 + rules.skills.maxGroups * 3 + entries.length * 12 + bulletWords;
}

export function targetPages(profile: MasterProfile, rules: WritingRules, now: Date) {
	return experienceYears(profile, now) >= rules.pages.experiencedYears ? rules.pages.experienced : rules.pages.early;
}

export function fitToPages(input: {
	plan: ResumeSelectionPlan;
	analysis: JobAnalysis;
	profile: MasterProfile;
	rules: WritingRules;
	now: Date;
}): { plan: ResumeSelectionPlan; trimmed: number; pages: number } {
	const { plan, rules } = input;
	const pages = targetPages(input.profile, rules, input.now);
	const budget = pages * rules.wordsPerPage;
	const reason = `Left out to fit the ${pages}-page target; include it if you'd rather have it.`;
	let trimmed = 0;

	// The lead role (the first included position: current or most recent) carries the resume, so it keeps up to
	// three bullets and is trimmed last; other positions keep one. Projects and older roles give way first.
	const lead = plan.entries.find((entry) => entry.include && entry.kind === "position");
	const weight = (entry: (typeof plan.entries)[number]) => (entry === lead ? 0.3 : entry.kind === "position" ? 0.1 : 0);
	const removable = () =>
		plan.entries
			.filter((entry) => entry.include)
			.flatMap((entry) => {
				const included = entry.achievements.filter((item) => item.include);
				const floor = entry === lead ? Math.min(3, included.length) : entry.kind === "education" ? 0 : 1;
				if (included.length <= floor) return [];
				return included.filter((item) => !item.userEdited && !item.core).map((item) => ({ entry, item }));
			})
			.toSorted((a, b) => a.item.score.total + weight(a.entry) - (b.item.score.total + weight(b.entry)));

	while (estimateWords(plan, rules) > budget) {
		const weakest = removable()[0];
		if (!weakest) break;
		weakest.item.include = false;
		weakest.item.reason = reason;
		trimmed++;
	}
	// Still over: whole projects and volunteer roles, weakest first.
	while (estimateWords(plan, rules) > budget) {
		const entry = plan.entries
			.filter(
				(item) =>
					item.include &&
					!item.userEdited &&
					(item.kind === "project" || item.kind === "volunteer") &&
					!item.achievements.some((achievement) => achievement.include && (achievement.userEdited || achievement.core)),
			)
			.toSorted(
				(a, b) =>
					Math.max(0, ...a.achievements.filter((x) => x.include).map((x) => x.score.total)) -
					Math.max(0, ...b.achievements.filter((x) => x.include).map((x) => x.score.total)),
			)[0];
		if (!entry) break;
		entry.include = false;
		entry.reason = reason;
		for (const item of entry.achievements.filter((x) => x.include)) {
			item.include = false;
			item.reason = reason;
			trimmed++;
		}
	}
	return { plan: trimmed > 0 ? finalize(plan, input.analysis) : plan, trimmed, pages };
}
