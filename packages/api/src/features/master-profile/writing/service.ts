import type { AskModel } from "../selection/model";
import type { MasterProfile } from "../service";
import type { Written } from "./write";
import type { JobAnalysis, ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import type { WritingRules } from "@reactive-resume/schema/resume-writing";
import { ORPCError } from "@orpc/client";
import { chooseSkills } from "./skills";
import { acceptWriting, WRITER_SYSTEM, writerOutputSchema, writerPrompt } from "./write";

/**
 * Words a reviewed plan: chooses and groups the skills, asks the AI for the headline, summary, bullets and group
 * names (unless the user wants their exact wording), and checks every piece against the record.
 */
export async function writeFromPlan(input: {
	userId: string;
	plan: ResumeSelectionPlan;
	analysis: JobAnalysis | null;
	profile: MasterProfile;
	rules: WritingRules;
	mode: "rephrase" | "verbatim";
	ask: AskModel;
	signal?: AbortSignal | undefined;
}): Promise<Written & { model: string }> {
	const { plan, profile, rules } = input;
	const { skills, leftOut } = chooseSkills(profile, plan, rules);
	const base = { plan, profile, skills, skillsLeftOut: leftOut, rules };
	if (input.mode === "verbatim" || !input.analysis)
		return { ...acceptWriting({ ...base, output: null, keys: null, rules: { ...rules, headline: false } }), model: "" };

	const { prompt, keys } = writerPrompt({ plan, analysis: input.analysis, profile, skills, rules });
	try {
		const answer = await input.ask({
			userId: input.userId,
			system: WRITER_SYSTEM,
			prompt,
			schema: writerOutputSchema,
			signal: input.signal,
		});
		return { ...acceptWriting({ ...base, output: answer.output, keys }), model: answer.model };
	} catch (error) {
		// An unreadable answer still gives a resume in the user's own words; connection problems are reported.
		if (error instanceof ORPCError && error.code === "INTERNAL_SERVER_ERROR") {
			const written = acceptWriting({ ...base, output: null, keys: null, rules: { ...rules, headline: false } });
			written.warnings.unshift("The AI's wording couldn't be read, so your own wording is used throughout.");
			return { ...written, model: "" };
		}
		throw error;
	}
}
