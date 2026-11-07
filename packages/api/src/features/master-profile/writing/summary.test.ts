import type { AskModel } from "../selection/model";
import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_WRITING_RULES } from "@reactive-resume/schema/resume-writing";
import { communicationsJob, consultantProfile, entry } from "../selection/fixtures";
import { recencyOf, tenureOf } from "../selection/rank";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { writeFromPlan } from "./service";
import { writeSummary } from "./summary";

const now = new Date("2026-11-01T00:00:00Z");

async function draft() {
	const profile = consultantProfile();
	const analysis = communicationsJob();
	const { plan } = await buildSelection({
		applicationId: "app",
		analysis,
		profile,
		blocked: new Map(),
		emphasis: { text: "", tokens: tokens("") },
		previous: null,
		now,
		review: async () => null,
	});
	const written = await writeFromPlan({
		userId: "u",
		plan,
		analysis,
		profile,
		rules: DEFAULT_WRITING_RULES,
		mode: "verbatim",
		ask: async () => {
			throw new Error("unused");
		},
	});
	return { profile, analysis, plan, written };
}

describe("the summary, written last", () => {
	it("is written from the finished resume, for this job", async () => {
		const { profile, analysis, plan, written } = await draft();
		const prompts: string[] = [];
		const ask: AskModel = async ({ prompt, schema }) => {
			prompts.push(prompt);
			return {
				model: "stub",
				output: schema.parse({
					summary: "Communications professional who raised $48,000 in six weeks for a food bank.",
				}),
			};
		};
		const result = await writeSummary({
			userId: "u",
			plan,
			analysis,
			profile,
			written,
			rules: DEFAULT_WRITING_RULES,
			ask,
			now,
		});
		expect(result.warnings).toEqual([]);
		expect(written.summary).toBe("Communications professional who raised $48,000 in six weeks for a food bank.");
		// The prompt shows the final bullets and the honest years of experience.
		const firstBullet = [...written.bullets.values()][0]?.text ?? "";
		expect(prompts[0]).toContain(`- ${firstBullet}`);
		expect(prompts[0]).toMatch(/Experience: \d+ years in total/);
	});

	it("retries once with the reason, then leaves the summary out rather than overclaim", async () => {
		const { profile, analysis, plan, written } = await draft();
		const prompts: string[] = [];
		const ask: AskModel = async ({ prompt, schema }) => {
			prompts.push(prompt);
			return { model: "stub", output: schema.parse({ summary: "Web expert with 43 years of experience." }) };
		};
		const result = await writeSummary({
			userId: "u",
			plan,
			analysis,
			profile,
			written,
			rules: DEFAULT_WRITING_RULES,
			ask,
			now,
		});
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toMatch(/couldn't be used because it introduced number 43/);
		expect(written.summary).toBe("");
		expect(result.warnings[0]).toMatch(/^Left the summary out/);
	});
});

describe("recent, long-held roles", () => {
	it("count for more than older or shorter ones", () => {
		const founder = entry("f", "position", "Founder", "Studio", "2020-06", null, []);
		const junior = entry("j", "position", "Junior Developer", "Agency", "2020-01", "2021-05", []);
		expect(recencyOf(founder, now)).toBe(1);
		expect(recencyOf(junior, now)).toBeLessThan(0.5);
		expect(tenureOf(founder, now)).toBe(1);
		expect(tenureOf(junior, now)).toBeCloseTo(1.33 / 5, 1);
	});
});
