import type { MasterProfile } from "../service";
import type { GapReport, JobAnalysis, ProfileGap, ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import { TOOLS } from "../writing/grounding";
import { keywordAssessment, matchFromRatings } from "./assessment";
import { words } from "./text";

/**
 * Profile gaps: what a posting asks for that the master profile doesn't show anywhere, so the user can say
 * whether they have it and add it to their profile before the resume is written. With the AI's fit assessment,
 * requirements rated "only adjacent" or "none" are asked about; without it, ones the profile can't evidence at all.
 */

const phrase = (text: string) => words(text).join(" ");

/** Openings that wrap a skill in a sentence: "proficiency with", "skilled in", "the creation of". */
const LEAD_IN =
	/^(?:(?:strong|excellent|proven|demonstrated|solid|working|good|sound|advanced|basic)\s+)*(?:experience (?:with|in|using)|proficiency (?:with|in)|knowledge of|familiarity with|skilled in|skills? in|ability to use|expertise in|understanding of|including|such as|the creation of|creation of|use of|with)\s+/i;

/** Words that aren't skills on their own. */
const GENERIC = new Set([
	"skills",
	"skill",
	"experience",
	"related technologies",
	"related",
	"other",
	"others",
	"etc",
	"tools",
	"platforms",
	"systems",
	"applications",
	"computer systems",
	"technologies",
	"other digital communications channels",
	// Adjectives left over when "digital and multimedia content" is split.
	"digital",
	"visual",
	"written",
	"verbal",
	"interpersonal",
	"online",
	"print",
]);

/** Skill names a requirement names: its alternative terms, and the items of a list in its text. */
export function skillCandidates(requirement: JobAnalysis["requirements"][number]): string[] {
	const pieces = [...requirement.terms, ...requirement.text.split(/[,;:()]|\s+(?:and|or|&|\/)\s+/i)]
		.map((piece) => piece.trim().replace(LEAD_IN, "").replace(LEAD_IN, "").replace(/[.]+$/, "").trim())
		.filter((piece) => {
			const count = words(piece).length;
			return count >= 1 && count <= 4 && !GENERIC.has(phrase(piece));
		});
	const seen = new Set<string>();
	return pieces.filter((piece) => {
		const key = phrase(piece);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Words that qualify a skill rather than name it: "WordPress development" is WordPress. */
const QUALIFIERS = new Set([
	"development",
	"management",
	"skills",
	"skill",
	"experience",
	"tools",
	"tool",
	"applications",
	"application",
	"software",
	"systems",
	"system",
	"platforms",
	"platform",
	"knowledge",
	"proficiency",
	"use",
]);

/** True when the profile already shows a skill: as a skill or alias, or named in a record. */
function inProfile(name: string, profile: MasterProfile, haystack: string) {
	const full = phrase(name);
	const core = words(name)
		.filter((word) => !QUALIFIERS.has(word))
		.join(" ");
	const key = core || full;
	if (!key) return true;
	const names = profile.skills.flatMap((skill) => [skill.name, ...skill.aliases]).map(phrase);
	if (names.some((item) => item === key || ` ${item} `.includes(` ${key} `) || ` ${key} `.includes(` ${item} `)))
		return true;
	return haystack.includes(` ${key} `);
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const TOOL_NAMES = new Set(TOOLS.map(phrase));

/**
 * A named product or platform rather than an ability: a known tool, a name with an inner capital ("HubSpot"), or
 * anything a requirement about a specific tool names.
 */
export function kindOf(name: string, requirement: JobAnalysis["requirements"][number]): "skill" | "tool" {
	if (requirement.kind === "tool" || TOOL_NAMES.has(phrase(name)) || /[a-z][A-Z]/.test(name)) return "tool";
	return "skill";
}

/** The match shown to the user: the AI's ratings when it ran, the keyword estimate otherwise. */
export function assessmentOf(plan: ResumeSelectionPlan, analysis: JobAnalysis) {
	const assessment = plan.assessment ?? keywordAssessment(plan, analysis);
	// Recomputed so a changed weighting or a re-analysed posting never shows a stale number.
	const match = matchFromRatings(
		analysis,
		new Map(assessment.ratings.map((item) => [item.requirementId, item.rating])),
	);
	return { ...assessment, match };
}

export function gapReport(input: {
	analysis: JobAnalysis;
	plan: ResumeSelectionPlan;
	profile: MasterProfile;
	answers: Array<{ requirementId: string; answer: "no" | "added" }>;
}): GapReport {
	const { analysis, plan, profile } = input;
	const haystack = ` ${phrase(
		[
			...profile.entries.flatMap((entry) => [
				entry.title,
				entry.summary,
				...entry.tags,
				...entry.achievements.flatMap((item) => [item.text, ...item.variants, ...item.skills, ...item.tags]),
			]),
			...profile.standalone.flatMap((item) => [item.text, ...item.skills, ...item.tags]),
		].join(" ; "),
	)} `;
	const answers = new Map(input.answers.map((item) => [item.requirementId, item.answer]));
	const assessment = assessmentOf(plan, analysis);
	const rated = new Map(assessment.ratings.map((item) => [item.requirementId, item]));
	const gaps: ProfileGap[] = [];
	for (const requirement of analysis.requirements) {
		const coverage = plan.coverage.find((item) => item.requirementId === requirement.id);
		const status = coverage?.status ?? "gap";
		const named = requirement.kind === "skill" || requirement.kind === "tool";
		// Skills and tools the requirement names that the profile has under no name.
		const missing = named
			? skillCandidates(requirement)
					.filter((name) => !inProfile(name, profile, haystack))
					.slice(0, 6)
					.map((name) => ({ name: capitalise(name), kind: kindOf(name, requirement) }))
			: [];
		// Weak evidence: rated adjacent or none by the AI; without its ratings, nothing in the profile evidences it.
		const weak =
			plan.assessment !== undefined
				? (rated.get(requirement.id)?.rating ?? 0) <= 1
				: status === "gap" && (coverage?.available.length ?? 0) === 0;
		if (!weak && missing.length === 0) continue;
		const type = missing.length > 0 ? "skill" : "experience";
		gaps.push({
			requirementId: requirement.id,
			text: requirement.text,
			kind: requirement.kind,
			necessity: requirement.necessity,
			importance: requirement.importance,
			type,
			skills: missing,
			answer: answers.get(requirement.id) ?? null,
		});
	}
	gaps.sort(
		(a, b) => Number(b.necessity === "mandatory") - Number(a.necessity === "mandatory") || b.importance - a.importance,
	);
	const byId = new Map(analysis.requirements.map((item) => [item.id, item]));
	const ratings = assessment.ratings.flatMap((item) => {
		const requirement = byId.get(item.requirementId);
		return requirement
			? [
					{
						requirementId: item.requirementId,
						text: requirement.text,
						necessity: requirement.necessity,
						importance: requirement.importance,
						rating: item.rating,
						reason: item.reason,
					},
				]
			: [];
	});
	ratings.sort(
		(a, b) => b.importance - a.importance || Number(b.necessity === "mandatory") - Number(a.necessity === "mandatory"),
	);
	return {
		match: assessment.match,
		basis: assessment.basis,
		ratings,
		summary: assessment.summary,
		supported: ratings.filter((item) => item.rating >= 2).length,
		partial: ratings.filter((item) => item.rating === 1).length,
		total: analysis.requirements.length,
		gaps: gaps.slice(0, 15),
	};
}
