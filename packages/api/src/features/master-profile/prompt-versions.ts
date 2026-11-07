/**
 * Versions of the tailoring prompts, recorded with each resume so benchmark runs and real resumes can be compared
 * across prompt changes. Bump one whenever its prompt or system message changes meaningfully.
 */
export const PROMPT_VERSIONS = {
	analysis: "analysis-2",
	evidence: "evidence-2",
	writing: "writing-3",
	review: "review-2",
} as const;
