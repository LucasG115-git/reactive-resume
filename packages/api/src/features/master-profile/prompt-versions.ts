/**
 * Versions of the tailoring prompts, recorded with each resume so benchmark runs and real resumes can be compared
 * across prompt changes. Bump one whenever its prompt or system message changes meaningfully.
 */
export const PROMPT_VERSIONS = {
	analysis: "analysis-4",
	evidence: "evidence-4",
	writing: "writing-5",
	review: "review-3",
	summary: "summary-1",
	fit: "fit-1",
} as const;
