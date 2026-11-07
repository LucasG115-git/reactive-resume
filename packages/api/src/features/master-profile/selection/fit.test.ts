import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_WRITING_RULES } from "@reactive-resume/schema/resume-writing";
import { SELECTION_RULES } from "./compose";
import { estimateWords, fitToPages } from "./fit";
import { consultantProfile, webDevJob } from "./fixtures";
import { buildSelection } from "./service";
import { tokens } from "./text";

const now = new Date("2026-11-01T00:00:00Z");

describe("fitting to the page target", () => {
	it("leaves projects whole or out, never thinned to a line or two", async () => {
		const profile = consultantProfile();
		const analysis = webDevJob();
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
		const projects = () => plan.entries.filter((entry) => entry.include && entry.kind === "project");
		expect(projects().length).toBeGreaterThan(0);
		// A budget well under what the plan needs.
		const rules = { ...DEFAULT_WRITING_RULES, wordsPerPage: 200 };
		rules.pages = { ...rules.pages, early: 1, experienced: 1 };
		expect(estimateWords(plan, rules)).toBeGreaterThan(200);
		const count = (entry: (typeof plan.entries)[number]) => entry.achievements.filter((item) => item.include).length;
		const before = new Map(projects().map((entry) => [entry.entryId, count(entry)]));
		const fitted = fitToPages({ plan, analysis, profile, rules, now }).plan;
		for (const entry of fitted.entries.filter((item) => item.kind === "project" && before.has(item.entryId))) {
			if (!entry.include) continue;
			expect(count(entry)).toBeGreaterThanOrEqual(
				Math.min(SELECTION_RULES.minBullets.project, before.get(entry.entryId) ?? 0),
			);
		}
	});
});
