import type { AskModel } from "../selection/model";
import { describe, expect, it } from "vite-plus/test";
import { ORPCError } from "@orpc/client";
import { DEFAULT_WRITING_RULES, MAX_REVIEW_REVISIONS } from "@reactive-resume/schema/resume-writing";
import { correctionsFrom, feedbackBlock } from "../feedback";
import { communicationsJob, consultantProfile } from "../selection/fixtures";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { acceptReview, reviewDraft, reviewerOutputSchema, reviewerPrompt } from "./review";
import { writeFromPlan } from "./service";
import { writerPrompt } from "./write";

const now = new Date("2026-11-01T00:00:00Z");
const rules = DEFAULT_WRITING_RULES;

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
		rules,
		mode: "verbatim",
		ask: async () => {
			throw new Error("unused");
		},
	});
	written.summary = "Communications professional with nonprofit experience.";
	return { profile, analysis, plan, written };
}

const finding = (ref: string | null, rewrite: string | null, extra: Record<string, unknown> = {}) => ({
	category: "strength",
	severity: "medium",
	message: "Lead with the result.",
	ref,
	rewrite,
	changesClaim: false,
	...extra,
});

describe("the AI reviewer", () => {
	it("shows each bullet with its record and keys it for the answer", async () => {
		const { plan, analysis, profile, written } = await draft();
		const { prompt, keys } = reviewerPrompt({ plan, analysis, profile, written });
		expect(prompt).toContain("B1: ");
		expect(prompt).toContain("record: ");
		expect(keys.size).toBe(written.bullets.size);
	});

	it("applies wording-only rewrites, keeps the draft wording, and holds back changed claims", async () => {
		const { plan, analysis, profile, written } = await draft();
		const { keys } = reviewerPrompt({ plan, analysis, profile, written });
		const campaign = [...keys].find(([, id]) => id === "a-campaign")?.[0] ?? "";
		const media = [...keys].find(([, id]) => id === "a-media")?.[0] ?? "";
		const annual = [...keys].find(([, id]) => id === "a-annual")?.[0] ?? "";
		const before = written.bullets.get("a-campaign")?.text;
		const output = reviewerOutputSchema.parse({
			score: 7,
			findings: [
				finding(campaign, "Raised $48,000 in six weeks with a donor email and social media campaign for a food bank"),
				// A number the record doesn't state is held for the user.
				finding(media, "Wrote press releases and pitched local media, earning 45 news stories about community grants"),
				// The reviewer says the rewrite changes the claim.
				finding(annual, "Led the foundation's annual report", { changesClaim: true }),
				finding("B99", "Ghost bullet"),
				finding(null, null, { category: "relevance", message: "Show media relations earlier." }),
			],
		});
		const result = acceptReview({ output, keys, plan, profile, written, rules });
		expect(result.score).toBe(7);
		expect(result.findings.map((item) => item.ref)).toEqual(["a-campaign", "a-media", "a-annual", null]);
		expect(result.revisions.map((item) => [item.achievementId, item.status])).toEqual([
			["a-campaign", "applied"],
			["a-media", "needs-review"],
			["a-annual", "needs-review"],
		]);
		expect(result.revisions[0]?.before).toBe(before);
		expect(written.bullets.get("a-campaign")?.text).toMatch(/^Raised \$48,000/);
		expect(written.bullets.get("a-media")?.text).not.toContain("45");
		expect(result.revisions[1]?.reason).toMatch(/number|45/);
	});

	it("applies at most a limited number of rewrites in one round", async () => {
		const { plan, analysis, profile, written } = await draft();
		const { keys } = reviewerPrompt({ plan, analysis, profile, written });
		const output = reviewerOutputSchema.parse({
			score: null,
			findings: [...keys].map(([key, id]) =>
				finding(key, `${written.bullets.get(id)?.text.replace(/\.$/, "")} for the team`),
			),
		});
		const result = acceptReview({ output, keys, plan, profile, written, rules });
		expect(result.revisions.filter((item) => item.status === "applied")).toHaveLength(
			Math.min(MAX_REVIEW_REVISIONS, keys.size),
		);
	});

	it("leaves the draft unchanged when the review fails", async () => {
		const { plan, analysis, profile, written } = await draft();
		const ask: AskModel = async () => {
			throw new ORPCError("INTERNAL_SERVER_ERROR");
		};
		const before = [...written.bullets.values()].map((item) => item.text);
		const result = await reviewDraft({ userId: "u", plan, analysis, profile, written, rules, ask });
		expect(result.review).toBeNull();
		expect(result.warnings[0]).toMatch(/unchanged/);
		expect([...written.bullets.values()].map((item) => item.text)).toEqual(before);
	});
});

describe("feedback", () => {
	it("pairs generated lines with the user's edits, ignoring deleted and untouched ones", async () => {
		const { written } = await draft();
		const bullets = [...written.bullets].map(([achievementId, bullet]) => ({
			achievementId,
			entryId: null,
			text: bullet.text,
			source: bullet.source,
		}));
		const data = structuredClone((await import("@reactive-resume/schema/resume/default")).defaultResumeData);
		const kept = bullets.slice(0, 2).map((item) => item.text);
		const edited = `${bullets[2]?.text.replace(/^\w+/, "Drove")}`;
		data.sections.experience.items = [
			{
				...({} as (typeof data.sections.experience.items)[number]),
				id: "x",
				hidden: false,
				description: `<ul>${[...kept, edited].map((text) => `<li><p>${text}</p></li>`).join("")}</ul>`,
			} as never,
		];
		data.summary.content = "<p>Communications lead for nonprofits.</p>";
		const corrections = correctionsFrom(
			{
				coverage: [],
				bullets,
				entryIds: [],
				skillIds: [],
				summaryUsed: true,
				warnings: [],
				writing: { summary: "Communications professional with nonprofit experience.", headline: "" } as never,
			},
			data,
		);
		expect(corrections).toEqual([
			{ target: "bullet", achievementId: bullets[2]?.achievementId, generated: bullets[2]?.text, edited },
			{
				target: "summary",
				achievementId: null,
				generated: "Communications professional with nonprofit experience.",
				edited: "Communications lead for nonprofits.",
			},
		]);
	});

	it("reaches the writer as preferences, never as record", async () => {
		const { plan, analysis, profile, written } = await draft();
		const block = feedbackBlock([
			{
				rating: "needs-work",
				note: "Less formal, please",
				corrections: [{ target: "bullet", achievementId: "a", generated: "Led workshops", edited: "Ran workshops" }],
			},
		]);
		const { prompt } = writerPrompt({ plan, analysis, profile, skills: written.skills, rules, feedback: block });
		expect(prompt).toContain("USER_FEEDBACK");
		expect(prompt).toContain("Wanted changed: Less formal, please");
		expect(prompt).toMatch(/Never treat it as a fact/);
		expect(feedbackBlock([])).toBe("");
	});
});
