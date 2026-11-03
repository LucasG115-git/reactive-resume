/**
 * Versions of the tailoring prompts, recorded with each resume so benchmark runs and real resumes can be compared
 * across prompt changes. Bump one whenever its prompt or system message changes meaningfully.
 */
export const PROMPT_VERSIONS = {
	analysis: "analysis-1",
	evidence: "evidence-1",
	writing: "writing-2",
	review: "review-1",
} as const;
