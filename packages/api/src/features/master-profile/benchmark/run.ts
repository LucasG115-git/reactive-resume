import type { AskModel } from "../selection/model";
import type { BenchmarkCase } from "./cases";
import type { TokenUsage } from "@reactive-resume/schema/ai-tasks";
import type { JobAnalysis } from "@reactive-resume/schema/resume-selection";
import type { QualityFinding, ResumeReview, WritingRules } from "@reactive-resume/schema/resume-writing";
import { DEFAULT_WRITING_RULES } from "@reactive-resume/schema/resume-writing";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { buildResume } from "../assemble/build";
import { validateRendering } from "../assemble/rendering";
import { PROMPT_VERSIONS } from "../prompt-versions";
import { analysisOutputSchema, analysisPrompt, ANALYSIS_SYSTEM, normalizeAnalysis } from "../selection/analysis";
import { REVIEW_SYSTEM, reviewOutputSchema } from "../selection/review";
import { buildSelection, usageOf } from "../selection/service";
import { tokens } from "../selection/text";
import { checkResume } from "../writing/checks";
import { reviewDraft } from "../writing/review";
import { writeFromPlan } from "../writing/service";
import { writeSummary } from "../writing/summary";

/** One model setup to benchmark: how each task is answered, plus what to run. */
export type BenchmarkConfig = {
	label: string;
	ask: AskModel;
	quality?: "standard" | "thorough";
	/** Analyse the posting text with the extraction model instead of using the case's reference analysis. */
	analyze?: boolean;
	/** Run the AI reviewer over the draft. */
	review?: boolean;
	/** Render and read back the PDF and DOCX (slower). */
	render?: boolean;
	rules?: WritingRules;
};

export type CaseRun = {
	caseId: string;
	family: string;
	config: string;
	analysis: JobAnalysis;
	included: string[];
	skills: string[];
	coverage: Array<{ requirementId: string; necessity: "mandatory" | "preferred"; status: string }>;
	bullets: Array<{ achievementId: string; text: string; source: string }>;
	findings: QualityFinding[];
	warnings: string[];
	review: ResumeReview | null;
	stats: { words: number; estimatedPages: number; targetPages: number; bullets: number; renderedPages: number | null };
	rendering: { textCoverage: number; blankPages: number; atsScore: number | null; docxCoverage: number | null } | null;
	usage: TokenUsage[];
	durationMs: number;
	promptVersions: Record<string, string>;
	error: string | null;
};

const now = new Date("2026-11-01T00:00:00Z");

/** Runs the whole tailoring pipeline for one case, the same steps a user's resume goes through, without a database. */
export async function runCase(item: BenchmarkCase, config: BenchmarkConfig): Promise<CaseRun> {
	const started = Date.now();
	const usage: TokenUsage[] = [];
	const ask: AskModel = async (input) => {
		const answer = await config.ask(input);
		usage.push(usageOf(input.task, input.task, answer));
		return answer;
	};
	const rules = config.rules ?? DEFAULT_WRITING_RULES;
	const profile = item.profile();
	const base: Omit<CaseRun, "analysis"> = {
		caseId: item.id,
		family: item.family,
		config: config.label,
		included: [],
		skills: [],
		coverage: [],
		bullets: [],
		findings: [],
		warnings: [],
		review: null,
		stats: { words: 0, estimatedPages: 0, targetPages: item.targetPages, bullets: 0, renderedPages: null },
		rendering: null,
		usage,
		durationMs: 0,
		promptVersions: { ...PROMPT_VERSIONS },
		error: null,
	};
	let analysis = item.analysis();
	try {
		if (config.analyze) {
			const prompt = { role: analysis.title, company: analysis.employer, posting: item.posting, extracted: [] };
			const answer = await ask({
				userId: "benchmark",
				task: "extraction",
				quality: config.quality,
				system: ANALYSIS_SYSTEM,
				prompt: analysisPrompt(prompt),
				schema: analysisOutputSchema,
			});
			analysis = normalizeAnalysis(answer.output, { ...prompt, model: answer.model, now });
		}
		const { plan } = await buildSelection({
			applicationId: item.id,
			analysis,
			profile,
			blocked: new Map(),
			emphasis: { text: "", tokens: tokens("") },
			previous: null,
			now,
			rules,
			review: (prompt) =>
				ask({
					userId: "benchmark",
					task: "evidence",
					quality: config.quality,
					system: REVIEW_SYSTEM,
					prompt,
					schema: reviewOutputSchema,
				}).catch(() => null),
		});
		const written = await writeFromPlan({
			userId: "benchmark",
			plan,
			analysis,
			profile,
			rules,
			mode: "rephrase",
			ask,
			quality: config.quality,
			now,
		});
		const reviewed = config.review
			? await reviewDraft({
					userId: "benchmark",
					plan,
					analysis,
					profile,
					written,
					rules,
					ask,
					quality: config.quality,
				})
			: null;
		const summarised = await writeSummary({
			userId: "benchmark",
			plan,
			analysis,
			profile,
			written,
			rules,
			ask,
			quality: config.quality,
			now,
		});
		written.warnings.push(...summarised.warnings);
		const data = structuredClone(defaultResumeData);
		data.basics.name = "Avery Example";
		data.basics.email = "avery@example.test";
		data.basics.phone = "555-0100";
		data.basics.location = "Peterborough, ON";
		const built = buildResume({
			base: data,
			profile,
			plan,
			mode: "rephrase",
			now,
			selection: {
				achievements: [...written.bullets].map(([id, bullet]) => ({ id, text: bullet.text })),
				skills: written.skills.map((skill) => skill.id),
				summary: written.summary,
			},
			writing: { headline: written.headline, skillGroups: written.skillGroups },
		});
		const checks = checkResume({
			data: built.data,
			bullets: built.bullets,
			placements: built.placements,
			plan,
			profile,
			analysis,
			rules,
			headline: written.headline,
			evidenceNotes: built.evidenceNotes,
			now,
		});
		const rendering = config.render
			? await validateRendering({
					data: built.data,
					bullets: built.bullets.map((bullet) => bullet.text),
					targetPages: checks.stats.targetPages,
					now,
				})
			: null;
		return {
			...base,
			analysis,
			included: built.bullets.map((bullet) => bullet.achievementId),
			skills: written.skills.map((skill) => skill.id),
			coverage: plan.coverage.map((entry) => ({
				requirementId: entry.requirementId,
				necessity:
					analysis.requirements.find((requirement) => requirement.id === entry.requirementId)?.necessity ?? "preferred",
				status: entry.status,
			})),
			bullets: built.bullets.map((bullet) => ({
				achievementId: bullet.achievementId,
				text: bullet.text,
				source: bullet.source,
			})),
			findings: [...checks.findings, ...(rendering?.findings ?? [])],
			warnings: [...written.warnings, ...(reviewed?.warnings ?? [])],
			review: reviewed?.review ?? null,
			stats: {
				words: checks.stats.words,
				estimatedPages: checks.stats.estimatedPages,
				targetPages: checks.stats.targetPages,
				bullets: checks.stats.bullets,
				renderedPages: rendering?.report.pdf?.pages ?? null,
			},
			rendering: rendering
				? {
						textCoverage: rendering.report.pdf?.textCoverage ?? 0,
						blankPages: rendering.report.pdf?.blankPages.length ?? 0,
						atsScore: rendering.report.pdf?.atsScore ?? null,
						docxCoverage: rendering.report.docx?.textCoverage ?? null,
					}
				: null,
			durationMs: Date.now() - started,
		};
	} catch (error) {
		return {
			...base,
			analysis,
			durationMs: Date.now() - started,
			error: error instanceof Error ? error.message.slice(0, 300) : "failed",
		};
	}
}
