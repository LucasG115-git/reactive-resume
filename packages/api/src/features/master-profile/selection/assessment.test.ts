import type { AskModel } from "./model";
import { describe, expect, it } from "vite-plus/test";
import { ORPCError } from "@orpc/client";
import { assessFit, assessmentPrompt, matchFromRatings } from "./assessment";
import { communicationsJob, consultantProfile } from "./fixtures";
import { buildSelection } from "./service";
import { tokens } from "./text";

const now = new Date("2026-11-01T00:00:00Z");

async function proposal() {
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
	return { profile, analysis, plan };
}

const answering =
	(output: unknown): AskModel =>
	async ({ schema }) => ({ model: "stub/model", output: schema.parse(output) });

describe("the fit assessment", () => {
	it("weights ratings by importance: strong 100%, some 60%, adjacent 25%, none 0", async () => {
		const { analysis } = await proposal();
		const all = (rating: number) => new Map(analysis.requirements.map((item) => [item.id, rating]));
		expect(matchFromRatings(analysis, all(3))).toBe(100);
		expect(matchFromRatings(analysis, all(2))).toBe(60);
		expect(matchFromRatings(analysis, all(1))).toBe(25);
		expect(matchFromRatings(analysis, new Map())).toBe(0);
	});

	it("asks for the rubric with the included evidence, and keeps the AI's ratings and reasons", async () => {
		const { profile, analysis, plan } = await proposal();
		const prompt = assessmentPrompt({ analysis, plan, profile, now });
		expect(prompt).toContain("3 = strong, direct evidence");
		expect(prompt).toContain(analysis.requirements[0]?.text ?? "missing");
		const ratings = analysis.requirements.map((item, index) => ({
			id: item.id,
			rating: index === 0 ? 1 : 2,
			reason: index === 0 ? "Only wrote web copy." : "Some evidence.",
		}));
		const { assessment, usage } = await assessFit({
			userId: "u",
			analysis,
			plan,
			profile,
			now,
			ask: answering({ ratings, summary: "A partial fit." }),
		});
		expect(assessment).toMatchObject({ basis: "ai", summary: "A partial fit." });
		expect(assessment.ratings[0]).toMatchObject({ rating: 1, reason: "Only wrote web copy." });
		expect(assessment.match).toBeLessThan(60);
		expect(usage[0]).toMatchObject({ step: "fit", task: "evidence" });
	});

	it("falls back to the keyword estimate when the answer rates too little or can't be read", async () => {
		const { profile, analysis, plan } = await proposal();
		const thin = await assessFit({
			userId: "u",
			analysis,
			plan,
			profile,
			now,
			ask: answering({ ratings: [{ id: "R1", rating: 3, reason: "" }] }),
		});
		expect(thin.assessment.basis).toBe("keywords");
		const failed = await assessFit({
			userId: "u",
			analysis,
			plan,
			profile,
			now,
			ask: async () => Promise.reject(new ORPCError("INTERNAL_SERVER_ERROR")),
		});
		expect(failed.assessment.basis).toBe("keywords");
	});
});
