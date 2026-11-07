import type { MasterProfile } from "../service";
import type { GapReport, JobAnalysis, ProfileGap, ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import { words } from "./text";

/**
 * Profile gaps: what a posting asks for that the master profile doesn't show anywhere, so the user can say
 * whether they have it and add it to their profile before the resume is written. Requirements the profile can
 * already evidence (even if not selected) aren't asked about; neither are ones the user already answered.
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

/** 0–100, weighted by importance and necessity: supported counts fully, partial support half. */
export function matchScore(plan: ResumeSelectionPlan, analysis: JobAnalysis) {
	let earned = 0;
	let possible = 0;
	for (const requirement of analysis.requirements) {
		const weight = (requirement.importance / 5) * (requirement.necessity === "mandatory" ? 1 : 0.75);
		const status = plan.coverage.find((item) => item.requirementId === requirement.id)?.status ?? "gap";
		possible += weight;
		earned += weight * (status === "supported" ? 1 : status === "partial" ? 0.5 : 0);
	}
	return possible === 0 ? 0 : Math.round((earned / possible) * 100);
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
	const gaps: ProfileGap[] = [];
	for (const requirement of analysis.requirements) {
		const coverage = plan.coverage.find((item) => item.requirementId === requirement.id);
		const status = coverage?.status ?? "gap";
		const missing = skillCandidates(requirement)
			.filter((name) => !inProfile(name, profile, haystack))
			.map(capitalise)
			.slice(0, 6);
		const type = requirement.kind === "skill" ? "skill" : "experience";
		// Nothing in the profile evidences it (selected or not), or it names skills the profile has under no name.
		const unevidenced = status === "gap" && (coverage?.available.length ?? 0) === 0;
		if (!unevidenced && !(type === "skill" && missing.length > 0)) continue;
		if (type === "skill" && missing.length === 0) continue;
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
	const statuses = plan.coverage.map((item) => item.status);
	return {
		match: matchScore(plan, analysis),
		supported: statuses.filter((status) => status === "supported").length,
		partial: statuses.filter((status) => status === "partial").length,
		total: analysis.requirements.length,
		gaps: gaps.slice(0, 15),
	};
}
