import type { BenchmarkCase } from "./cases";
import type { CaseRun } from "./run";

/** Price per million tokens, in any one currency, keyed by "provider/model". Unknown models cost null. */
export type PriceTable = Record<string, { input: number; output: number }>;

export type CaseScore = {
	caseId: string;
	family: string;
	config: string;
	/** Included achievements that are on target (relevant, not off-target), 0–1. */
	relevance: number;
	/** Relevant achievements that made it in, 0–1. */
	recall: number;
	/** Off-target achievements included. */
	offTarget: number;
	/** Mandatory requirements shown by an included achievement, 0–1. */
	coverage: number;
	/** Bullets with no error-level finding against them and not rejected by the record checks, 0–1. */
	accuracy: number;
	/** Rewrites the record checks rejected (kept in the user's words instead). */
	rejectedRewrites: number;
	/** Warnings about wording (clichés, length, keyword stuffing). Lower is better. */
	writingIssues: number;
	/** The AI reviewer's 0–10 score, when it ran. */
	reviewScore: number | null;
	/** Listed skills the posting needs, 0–1, and needed skills listed, 0–1. */
	skillPrecision: number;
	skillRecall: number;
	/** Duplicate bullets or skills found. */
	redundancy: number;
	/** Estimated (or rendered) pages minus the target; ≤ 0 is within it. */
	lengthOver: number;
	/** 0–1 from the rendered PDF: text read back, no blank pages. Null when not rendered. */
	formatting: number | null;
	atsScore: number | null;
	inputTokens: number;
	outputTokens: number;
	cost: number | null;
	durationMs: number;
	error: string | null;
};

const ratio = (part: number, whole: number) => (whole === 0 ? 1 : part / whole);
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

const WRITING_CODES = new Set(["cliche", "bullet-length", "keyword-repetition", "summary-length"]);

export function scoreRun(item: BenchmarkCase, run: CaseRun, prices: PriceTable = {}): CaseScore {
	const included = new Set(run.included);
	const relevant = item.relevant.filter((id) => included.has(id)).length;
	const offTarget = item.offTarget.filter((id) => included.has(id)).length;
	const mandatory = run.coverage.filter((entry) => entry.necessity === "mandatory");
	const errorsByItem = new Set(
		run.findings.filter((finding) => finding.severity === "error").map((finding) => finding.itemId ?? finding.code),
	);
	const rejected = run.warnings.filter((warning) => warning.startsWith("Kept your wording")).length;
	const skills = new Set(run.skills);
	const needed = item.skills.filter((id) => skills.has(id)).length;
	const pages = run.stats.renderedPages ?? run.stats.estimatedPages;
	const inputTokens = run.usage.reduce((sum, entry) => sum + entry.inputTokens, 0);
	const outputTokens = run.usage.reduce((sum, entry) => sum + entry.outputTokens, 0);
	const costs = run.usage.map((entry) => {
		const price = prices[entry.model];
		return price ? (entry.inputTokens * price.input + entry.outputTokens * price.output) / 1_000_000 : null;
	});
	return {
		caseId: run.caseId,
		family: run.family,
		config: run.config,
		relevance: round(ratio(included.size - offTarget, included.size)),
		recall: round(ratio(relevant, item.relevant.length)),
		offTarget,
		coverage: round(ratio(mandatory.filter((entry) => entry.status === "supported").length, mandatory.length)),
		accuracy: run.bullets.length ? round(Math.max(0, 1 - errorsByItem.size / run.bullets.length)) : 0,
		rejectedRewrites: rejected,
		writingIssues: run.findings.filter((finding) => WRITING_CODES.has(finding.code)).length,
		reviewScore: run.review?.score ?? null,
		skillPrecision: round(ratio(needed, skills.size)),
		skillRecall: round(ratio(needed, item.skills.length)),
		redundancy: run.findings.filter(
			(finding) => finding.code === "duplicate-bullet" || finding.code === "duplicate-skill",
		).length,
		lengthOver: round(pages - run.stats.targetPages, 1),
		formatting: run.rendering
			? round(
					run.rendering.textCoverage * (run.rendering.blankPages === 0 ? 1 : 0.5) * (run.rendering.docxCoverage ?? 1),
				)
			: null,
		atsScore: run.rendering?.atsScore ?? null,
		inputTokens,
		outputTokens,
		cost:
			costs.length && costs.every((value) => value !== null)
				? round(
						costs.reduce((sum: number, value) => sum + (value ?? 0), 0),
						4,
					)
				: null,
		durationMs: run.durationMs,
		error: run.error,
	};
}

const COLUMNS: Array<[keyof CaseScore, string]> = [
	["relevance", "Relevance"],
	["recall", "Recall"],
	["coverage", "Coverage"],
	["accuracy", "Accuracy"],
	["rejectedRewrites", "Rejected rewrites"],
	["writingIssues", "Writing issues"],
	["reviewScore", "Review"],
	["skillPrecision", "Skills (precision)"],
	["skillRecall", "Skills (recall)"],
	["redundancy", "Redundancy"],
	["lengthOver", "Pages over"],
	["formatting", "Formatting"],
	["atsScore", "ATS"],
	["inputTokens", "Input tokens"],
	["outputTokens", "Output tokens"],
	["cost", "Cost"],
];

const cell = (value: unknown) => (value === null || value === undefined ? "–" : String(value));

/** A Markdown report: one table per job family comparing configurations, then averages per configuration. */
export function benchmarkReport(scores: CaseScore[], promptVersions: Record<string, string>) {
	const header = `| Config | ${COLUMNS.map(([, label]) => label).join(" | ")} |\n|${" --- |".repeat(COLUMNS.length + 1)}`;
	const row = (score: Partial<CaseScore> & { config: string }) =>
		`| ${score.config} | ${COLUMNS.map(([key]) => cell(score[key])).join(" | ")} |`;
	const families = [...new Set(scores.map((score) => score.family))];
	const configs = [...new Set(scores.map((score) => score.config))];
	const averages = configs.map((config) => {
		const own = scores.filter((score) => score.config === config && !score.error);
		const average: Partial<CaseScore> & { config: string } = { config };
		for (const [key] of COLUMNS) {
			const values = own.map((score) => score[key]).filter((value): value is number => typeof value === "number");
			(average as Record<string, unknown>)[key] = values.length
				? round(values.reduce((a, b) => a + b, 0) / values.length, key === "cost" ? 4 : 2)
				: null;
		}
		return average;
	});
	const errors = scores.filter((score) => score.error);
	return [
		"# Resume tailoring benchmark",
		"",
		`Prompt versions: ${Object.entries(promptVersions)
			.map(([key, value]) => `${key} ${value}`)
			.join(", ")}`,
		"",
		"## Averages",
		"",
		header,
		...averages.map(row),
		...families.flatMap((family) => [
			"",
			`## ${family}`,
			"",
			header,
			...scores.filter((score) => score.family === family).map(row),
		]),
		...(errors.length
			? ["", "## Errors", "", ...errors.map((score) => `- ${score.config} / ${score.caseId}: ${score.error}`)]
			: []),
		"",
	].join("\n");
}
