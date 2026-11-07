import { describe, expect, it } from "vite-plus/test";
import { communicationsJob, consultantProfile } from "./fixtures";
import { gapReport, matchScore, skillCandidates } from "./gaps";
import { buildSelection } from "./service";
import { tokens } from "./text";

const now = new Date("2026-11-01T00:00:00Z");

const requirement = (text: string, terms: string[] = [], kind: "skill" | "responsibility" = "skill") => ({
	id: "R9",
	text,
	kind,
	necessity: "mandatory" as const,
	origin: "explicit" as const,
	importance: 4,
	terms,
});

describe("skill names in a requirement", () => {
	it("splits lists and drops lead-ins and generic words", () => {
		expect(
			skillCandidates(
				requirement("Skilled in photography, videography, and the creation of digital and multimedia content"),
			),
		).toEqual(["photography", "videography", "multimedia content"]);
		expect(
			skillCandidates(
				requirement(
					"Proficiency with email marketing tools, web content management systems, Slate CRM, Microsoft Office applications, and related technologies",
					["Slate CRM"],
				),
			),
		).toEqual([
			"Slate CRM",
			"email marketing tools",
			"web content management systems",
			"Microsoft Office applications",
		]);
	});
});

describe("the gap report", () => {
	async function selection(extra?: ReturnType<typeof requirement>) {
		const profile = consultantProfile();
		const analysis = communicationsJob();
		if (extra) analysis.requirements.push(extra);
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

	it("scores the match by importance, counting partial support as half", async () => {
		const { analysis, plan } = await selection();
		const score = matchScore(plan, analysis);
		expect(score).toBeGreaterThan(0);
		expect(score).toBeLessThanOrEqual(100);
		const allSupported = {
			...plan,
			coverage: plan.coverage.map((item) => ({ ...item, status: "supported" as const })),
		};
		expect(matchScore(allSupported, analysis)).toBe(100);
	});

	it("asks only about what the profile shows nowhere, skills first by importance, with earlier answers", async () => {
		const { profile, analysis, plan } = await selection(
			requirement("Skilled in photography, videography and social media", ["Photography"]),
		);
		analysis.requirements.push({
			...requirement("Coordinate printers and photographers for publications", [], "responsibility"),
			id: "R10",
		});
		const report = gapReport({ analysis, plan, profile, answers: [{ requirementId: "R10", answer: "no" }] });
		const skills = report.gaps.find((gap) => gap.requirementId === "R9");
		expect(skills?.type).toBe("skill");
		// Social media is already a profile skill, so it isn't asked about.
		expect(skills?.skills).toEqual(["Photography", "Videography"]);
		const printers = report.gaps.find((gap) => gap.requirementId === "R10");
		expect(printers).toMatchObject({ type: "experience", answer: "no" });
		// Requirements the profile already evidences aren't gaps.
		expect(report.gaps.some((gap) => /newsletter|email/i.test(gap.text))).toBe(false);
	});
});
