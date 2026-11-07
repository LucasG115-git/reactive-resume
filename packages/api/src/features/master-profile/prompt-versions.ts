/**
 * Versions of the tailoring prompts, recorded with each resume so benchmark runs and real resumes can be compared
 * across prompt changes. Bump one whenever its prompt or system message changes meaningfully.
 */
export const PROMPT_VERSIONS = {
	analysis: "analysis-3",
	evidence: "evidence-3",
	writing: "writing-4",
	review: "review-3",
} as const;
