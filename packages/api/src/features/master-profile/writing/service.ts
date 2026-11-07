import type { AskModel } from "../selection/model";
import type { MasterProfile } from "../service";
import type { Written, WritingStyle } from "./write";
import type { TokenUsage } from "@reactive-resume/schema/ai-tasks";
import type { JobAnalysis, ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import type { WritingRules } from "@reactive-resume/schema/resume-writing";
import { ORPCError } from "@orpc/client";
import { usageOf } from "../selection/service";
import { alignTense, shortenApproximations, singleHeadline, stripEvidenceNotes } from "./hygiene";
import { chooseSkills } from "./skills";
import { acceptWriting, EXAMPLE_EXCERPT, WRITER_SYSTEM, writerOutputSchema, writerPrompt } from "./write";

/** A line as it will print: notes about evidence out, long approximations shortened. */
export const tidyLine = (text: string) => shortenApproximations(stripEvidenceNotes(text).text);

/**
 * Applies line hygiene to a draft in place, so what the reviewer sees and what's stored match what prints: tidy
 * lines, one tense per entry, a single headline.
 */
export function tidyWritten<T extends Written>(written: T, plan: ResumeSelectionPlan, profile: MasterProfile): T {
	const entries = new Map(profile.entries.map((entry) => [entry.id, entry]));
	for (const planned of plan.entries.filter((entry) => entry.include)) {
		const ids = planned.achievements.filter((item) => item.include && written.bullets.has(item.achievementId));
		const lines = ids.map((item) => tidyLine(written.bullets.get(item.achievementId)?.text ?? ""));
		const tensed = alignTense(lines, !entries.get(planned.entryId)?.endDate);
		ids.forEach((item, index) => {
			const bullet = written.bullets.get(item.achievementId);
			if (bullet) written.bullets.set(item.achievementId, { ...bullet, text: tensed[index] ?? bullet.text });
		});
	}
	written.summary = tidyLine(written.summary);
	written.headline = singleHeadline(written.headline);
	return written;
}

/**
 * Words a reviewed plan: chooses and groups the skills, asks the AI for the headline, summary, bullets and group
 * names (unless the user wants their exact wording), and checks every piece against the record.
 */
export async function writeFromPlan(input: Parameters<typeof writeUntidied>[0]) {
	const written = await writeUntidied(input);
	return tidyWritten(written, input.plan, input.profile);
}

async function writeUntidied(input: {
	userId: string;
	plan: ResumeSelectionPlan;
	analysis: JobAnalysis | null;
	profile: MasterProfile;
	rules: WritingRules;
	mode: "rephrase" | "verbatim";
	ask: AskModel;
	style?: WritingStyle | null | undefined;
	quality?: "standard" | "thorough" | undefined;
	feedback?: string | undefined;
	signal?: AbortSignal | undefined;
	now?: Date;
}): Promise<Written & { model: string; usage: TokenUsage[] }> {
	const { plan, profile, rules } = input;
	const { skills, leftOut } = chooseSkills(profile, plan, rules);
	const base = { plan, profile, skills, skillsLeftOut: leftOut, rules };
	if (input.mode === "verbatim" || !input.analysis)
		return {
			...acceptWriting({ ...base, output: null, keys: null, rules: { ...rules, headline: false } }),
			model: "",
			usage: [],
		};

	const { prompt, keys } = writerPrompt({
		plan,
		analysis: input.analysis,
		profile,
		skills,
		rules,
		style: input.style,
		feedback: input.feedback,
		...(input.now ? { now: input.now } : {}),
	});
	const examples = input.style?.examples.slice(0, 2).map((example) => example.text.slice(0, EXAMPLE_EXCERPT)) ?? [];
	try {
		const answer = await input.ask({
			userId: input.userId,
			task: "writing",
			quality: input.quality,
			system: WRITER_SYSTEM,
			prompt,
			schema: writerOutputSchema,
			signal: input.signal,
		});
		const written = acceptWriting({ ...base, output: answer.output, keys, examples });
		written.warnings.unshift(...(answer.notes ?? []));
		return { ...written, model: answer.model, usage: [usageOf("writing", "writing", answer)] };
	} catch (error) {
		// An unreadable answer still gives a resume in the user's own words; connection problems are reported.
		if (error instanceof ORPCError && error.code === "INTERNAL_SERVER_ERROR") {
			const written = acceptWriting({ ...base, output: null, keys: null, rules: { ...rules, headline: false } });
			written.warnings.unshift("The AI's wording couldn't be read, so your own wording is used throughout.");
			return { ...written, model: "", usage: [] };
		}
		throw error;
	}
}
