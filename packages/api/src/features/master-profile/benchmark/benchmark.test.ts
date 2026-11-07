import type { AskModel } from "../selection/model";
import type { BenchmarkConfig } from "./run";
import type { CaseScore, PriceTable } from "./score";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { PROMPT_VERSIONS } from "../prompt-versions";
import { BENCHMARK_CASES } from "./cases";
import { loadLiveConfigs } from "./live";
import { runCase } from "./run";
import { benchmarkReport, scoreRun } from "./score";

/**
 * The resume tailoring benchmark. By default it runs deterministic stand-in models, so the pipeline, the scoring
 * and the gold labels are checked on every test run. With RESUME_BENCHMARK_CONFIG set to a JSON file (see
 * live.ts), it runs real models instead and writes reports/resume-benchmark.{md,json} for comparison.
 */

const usage = { inputTokens: 1000, outputTokens: 200 };

/** Answers like a careful writer: tightens wording, keeps facts; one bullet invents a number to test rejection. */
const careful =
	(invent: boolean): AskModel =>
	async ({ task, prompt, schema, system }) => {
		// The summary, written last: the first finished bullet, which is grounded by construction.
		if (system.startsWith("You write the professional summary")) {
			const first = /^\s+- (.+)$/m.exec(prompt)?.[1] ?? "";
			return { model: "stub/writer", usage, output: schema.parse({ summary: first }) };
		}
		if (task === "writing") {
			const bullets = [...prompt.matchAll(/^\s+(A\d+): (.+?)(?: \[|$)/gm)].map(([, id, text], index) => ({
				id,
				text: invent && index === 0 ? `${text?.replace(/\.$/, "")}, for 3,000 people` : text,
			}));
			const skills = [...prompt.matchAll(/^\s+(S\d+): (.+)$/gm)].map(([, id]) => id);
			return {
				model: "stub/writer",
				usage,
				output: schema.parse({
					headline: "",
					summary: "",
					bullets,
					skillGroups: [
						{ name: "Core", skills: skills.slice(0, Math.ceil(skills.length / 2)) },
						{ name: "Tools & Platforms", skills: skills.slice(Math.ceil(skills.length / 2)) },
					],
				}),
			};
		}
		if (task === "review") return { model: "stub/reviewer", usage, output: schema.parse({ score: 7, findings: [] }) };
		// No usable evidence review: the ranking decides, which is what the gold labels are measured against.
		return { model: "stub/evidence", usage, output: schema.parse({}) };
	};

const STUBS: BenchmarkConfig[] = [
	{ label: "stub: careful", ask: careful(false), review: true, render: true },
	{ label: "stub: invents a number", ask: careful(true), review: false },
];
const PRICES: PriceTable = {
	"stub/writer": { input: 1, output: 4 },
	"stub/reviewer": { input: 1, output: 4 },
	"stub/evidence": { input: 1, output: 4 },
};

async function runAll(configs: BenchmarkConfig[], prices: PriceTable) {
	const scores: CaseScore[] = [];
	for (const config of configs)
		for (const item of BENCHMARK_CASES) scores.push(scoreRun(item, await runCase(item, config), prices));
	return scores;
}

describe("resume tailoring benchmark", () => {
	it("covers at least three job families", () => {
		expect(new Set(BENCHMARK_CASES.map((item) => item.family)).size).toBeGreaterThanOrEqual(3);
	});

	it("scores every case on relevance, accuracy, coverage, writing, skills, redundancy, length, formatting and cost", async () => {
		const scores = await runAll(STUBS, PRICES);
		expect(scores.filter((score) => score.error)).toEqual([]);
		const careful = scores.filter((score) => score.config === "stub: careful");
		for (const score of careful) {
			expect(score, score.caseId).toMatchObject({ accuracy: 1, rejectedRewrites: 0, redundancy: 0 });
			// A recent role keeps its strongest bullet so the timeline has no gap, even when it's off-target.
			expect(score.offTarget, score.caseId).toBeLessThanOrEqual(1);
			expect(score.relevance, score.caseId).toBeGreaterThanOrEqual(0.85);
			expect(score.recall, score.caseId).toBeGreaterThanOrEqual(0.6);
			expect(score.coverage, score.caseId).toBeGreaterThanOrEqual(0.6);
			expect(score.skillRecall, score.caseId).toBeGreaterThanOrEqual(0.5);
			expect(score.lengthOver, score.caseId).toBeLessThanOrEqual(0);
			expect(score.formatting, score.caseId).toBe(1);
			expect(score.reviewScore).toBe(7);
			// Four calls (evidence, writing, review, summary) at 1,000 in and 200 out, priced per million.
			expect(score.inputTokens).toBe(4000);
			expect(score.cost).toBeCloseTo((4 * (1000 * 1 + 200 * 4)) / 1_000_000, 6);
		}
		// Invented numbers never reach the resume: the record checks keep the user's words and count it.
		for (const score of scores.filter((item) => item.config === "stub: invents a number"))
			expect(score, score.caseId).toMatchObject({ accuracy: 1, rejectedRewrites: 1 });

		const report = benchmarkReport(scores, PROMPT_VERSIONS);
		expect(report).toContain("## Communications");
		expect(report).toContain("## Web development");
		expect(report).toContain("## Project management");
		expect(report).toContain("| stub: careful |");
	}, 120_000);

	it.runIf(Boolean(process.env.RESUME_BENCHMARK_CONFIG))(
		"runs the live configurations and writes the comparison",
		async () => {
			const { configs, prices } = await loadLiveConfigs(process.env.RESUME_BENCHMARK_CONFIG ?? "");
			const scores = await runAll(configs, prices);
			await mkdir("reports", { recursive: true });
			await writeFile("reports/resume-benchmark.md", benchmarkReport(scores, PROMPT_VERSIONS));
			await writeFile(
				"reports/resume-benchmark.json",
				JSON.stringify({ promptVersions: PROMPT_VERSIONS, scores }, null, 2),
			);
			expect(scores.length).toBe(configs.length * BENCHMARK_CASES.length);
		},
		30 * 60_000,
	);
});
