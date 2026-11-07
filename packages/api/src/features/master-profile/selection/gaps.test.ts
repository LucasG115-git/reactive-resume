import { describe, expect, it } from "vite-plus/test";
import { keywordAssessment, matchFromRatings } from "./assessment";
import { communicationsJob, consultantProfile } from "./fixtures";
import { gapReport, kindOf, skillCandidates } from "./gaps";
import { buildSelection } from "./service";
import { tokens } from "./text";

const now = new Date("2026-11-01T00:00:00Z");

const requirement = (text: string, terms: string[] = [], kind: "skill" | "tool" | "responsibility" = "skill") => ({
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

	it("estimates from keywords when the AI hasn't rated the fit, never reaching full marks", async () => {
		const { analysis, plan } = await selection();
		const estimate = keywordAssessment(plan, analysis);
		expect(estimate.basis).toBe("keywords");
		const allSupported = {
			...plan,
			coverage: plan.coverage.map((item) => ({ ...item, status: "supported" as const })),
		};
		// Word matches alone count as "some evidence" (60%), not strong evidence.
		expect(keywordAssessment(allSupported, analysis).match).toBe(60);
		const report = gapReport({ analysis, plan, profile: consultantProfile(), answers: [] });
		expect(report).toMatchObject({ basis: "keywords", match: estimate.match });
		expect(report.ratings).toHaveLength(analysis.requirements.length);
	});

	it("uses the AI's ratings for the match and asks about requirements it rated weak", async () => {
		const { profile, analysis, plan } = await selection();
		const [first, ...rest] = analysis.requirements;
		plan.assessment = {
			basis: "ai",
			match: 0,
			ratings: [
				{ requirementId: first?.id ?? "", rating: 1, reason: "Only adjacent work." },
				...rest.map((item) => ({ requirementId: item.id, rating: 3, reason: "Direct evidence." })),
			],
			summary: "Strong fit apart from the lead duty.",
			model: "stub",
		};
		const report = gapReport({ analysis, plan, profile, answers: [] });
		expect(report.basis).toBe("ai");
		expect(report.summary).toBe("Strong fit apart from the lead duty.");
		expect(report.match).toBe(
			matchFromRatings(analysis, new Map(plan.assessment.ratings.map((item) => [item.requirementId, item.rating]))),
		);
		expect(report.match).toBeLessThan(100);
		expect(report.gaps.map((gap) => gap.requirementId)).toContain(first?.id);
		expect(report.gaps.every((gap) => gap.requirementId === first?.id || gap.type === "skill")).toBe(true);
	});

	it("tells tools and platforms from skills", () => {
		expect(kindOf("WordPress", requirement("x"))).toBe("tool");
		expect(kindOf("HubSpot", requirement("x"))).toBe("tool");
		expect(kindOf("Slate CRM", requirement("x", [], "tool"))).toBe("tool");
		expect(kindOf("Photography", requirement("x"))).toBe("skill");
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
		expect(skills?.skills).toEqual([
			{ name: "Photography", kind: "skill" },
			{ name: "Videography", kind: "skill" },
		]);
		const printers = report.gaps.find((gap) => gap.requirementId === "R10");
		expect(printers).toMatchObject({ type: "experience", answer: "no" });
		// Requirements the profile already evidences aren't gaps.
		expect(report.gaps.some((gap) => /newsletter|email/i.test(gap.text))).toBe(false);
	});
});
