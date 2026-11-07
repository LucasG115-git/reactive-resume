import type { MasterProfile } from "../service";
import type { ReviewOutput } from "./review";
import type { ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import { describe, expect, it } from "vite-plus/test";
import { resumeSelectionPlanSchema } from "@reactive-resume/schema/resume-selection";
import { analysisOutputSchema, normalizeAnalysis } from "./analysis";
import { applyEdit } from "./compose";
import {
	achievement,
	analysisOf,
	communicationsJob,
	consultantProfile,
	entry,
	projectManagementJob,
	requirement,
	skill,
	webDevJob,
} from "./fixtures";
import { eligibleProfile, rankEvidence, requirementTerms, shortlist } from "./rank";
import { buildSelection } from "./service";
import { expand, tokens } from "./text";

const now = new Date("2026-11-01T00:00:00Z");
type Analysis = ReturnType<typeof communicationsJob>;

/** Runs the whole selection with an optional scripted AI review (by short id, as the model would answer). */
async function select(
	analysis: Analysis,
	profile: MasterProfile = consultantProfile(),
	options: {
		review?: (prompt: string) => ReviewOutput | null;
		blocked?: Map<string, string>;
		previous?: ResumeSelectionPlan | null;
		emphasis?: string;
	} = {},
) {
	let seenPrompt = "";
	const result = await buildSelection({
		applicationId: "app",
		analysis,
		profile,
		blocked: options.blocked ?? new Map(),
		emphasis: { text: options.emphasis ?? "", tokens: tokens(options.emphasis ?? "") },
		previous: options.previous ?? null,
		now,
		review: async (prompt) => {
			seenPrompt = prompt;
			const output = options.review?.(prompt) ?? null;
			return output ? { output, model: "stub/test" } : null;
		},
	});
	expect(resumeSelectionPlanSchema.safeParse(result.plan).success).toBe(true);
	return { ...result, prompt: seenPrompt };
}

const included = (plan: ResumeSelectionPlan) => ({
	entries: plan.entries.filter((item) => item.include).map((item) => item.entryId),
	achievements: plan.entries.flatMap((item) =>
		item.include ? item.achievements.filter((a) => a.include).map((a) => a.achievementId) : [],
	),
	skills: plan.skills.filter((item) => item.include).map((item) => item.skillId),
});
const entryOf = (plan: ResumeSelectionPlan, id: string) => plan.entries.find((item) => item.entryId === id);

/** The review key ("A3") the prompt gave a record, so scripted answers can refer to it. */
const keyOf = (prompt: string, text: string) => {
	const line = prompt.split("\n").find((row) => row.includes(text));
	return line?.match(/\b(A\d+):/)?.[1] ?? "";
};

describe("job analysis", () => {
	it("ranks requirements by importance, then mandatory, stated and original order, and drops duplicates", () => {
		const output = analysisOutputSchema.parse({
			title: "Manager",
			seniority: "boss",
			requirements: [
				{ text: "Excel", importance: 2, necessity: "preferred" },
				{ text: "Lead campaigns", importance: 5, necessity: "mandatory", origin: "explicit", terms: ["outreach"] },
				{ text: "Lead  campaigns", importance: 5 },
				{ text: "Stakeholder management", importance: 5, necessity: "mandatory", origin: "inferred" },
				{ text: "Budgeting", importance: "9" },
				null,
				{ bad: true },
			],
		});
		const analysis = normalizeAnalysis(output, {
			role: "Comms",
			company: "X",
			posting: "p",
			extracted: [],
			model: "m",
			now,
		});
		expect(analysis.seniority).toBe("unknown");
		expect(analysis.requirements.map((item) => [item.id, item.text, item.importance])).toEqual([
			["R1", "Lead campaigns", 5],
			["R2", "Stakeholder management", 5],
			["R3", "Budgeting", 5],
			["R4", "Excel", 2],
		]);
		expect(analysis.requirements[0]).toMatchObject({ necessity: "mandatory", origin: "explicit", terms: ["outreach"] });
	});

	it("falls back to the requirements extracted when the job was saved", () => {
		const analysis = normalizeAnalysis(analysisOutputSchema.parse({}), {
			role: "Analyst",
			company: "Y",
			posting: "p",
			extracted: ["SQL", "Dashboards"],
			model: "",
			now,
		});
		expect(analysis.title).toBe("Analyst");
		expect(analysis.requirements.map((item) => item.text)).toEqual(["SQL", "Dashboards"]);
	});
});

describe("matching different wording", () => {
	it("connects records and requirements that use different terms for the same evidence", () => {
		expect(tokens("Coordinated donor relations").has("donor")).toBe(true);
		expect(expand("Fundraising").has("donor")).toBe(true);
		const analysis = analysisOf({ requirements: [requirement("Fundraising", 5, "mandatory")] });
		const profile = consultantProfile();
		const ranked = rankEvidence(profile, {
			analysis,
			requirements: requirementTerms(analysis, profile.skills),
			emphasis: new Set(),
			now,
		});
		// "donor email campaign … raised $48,000" never says "fundraising".
		expect(ranked[0]?.achievement.id).toBe("a-campaign");
	});

	it("uses the profile's skill aliases", () => {
		const analysis = analysisOf({ requirements: [requirement("WCAG compliance", 5, "mandatory")] });
		const profile = consultantProfile();
		const ranked = rankEvidence(profile, {
			analysis,
			requirements: requirementTerms(analysis, profile.skills),
			emphasis: new Set(),
			now,
		});
		expect(ranked[0]?.achievement.id).toBe("a-a11y");
	});
});

describe("selection plans", () => {
	it("communications: recent nonprofit communications outranks unrelated early employment", async () => {
		const { plan } = await select(communicationsJob());
		const chosen = included(plan);
		expect(chosen.entries).toEqual(expect.arrayContaining(["e-founder", "e-comms"]));
		expect(chosen.entries).not.toContain("e-retail");
		expect(entryOf(plan, "e-retail")?.reason).toMatch(/Older|evidence/);
		const founder = entryOf(plan, "e-founder");
		// The campaign and newsletter work leads the consultancy's bullets; the plugin build isn't needed here.
		expect(founder?.achievements.slice(0, 2).map((item) => item.achievementId)).toEqual(
			expect.arrayContaining(["a-campaign", "a-newsletter"]),
		);
		expect(founder?.achievements.find((item) => item.achievementId === "a-plugin")?.include).toBe(false);
		expect(chosen.skills).toEqual(expect.arrayContaining(["s-copy", "s-social"]));
		expect(chosen.skills).not.toContain("s-php");
		expect(plan.coverage.find((item) => item.requirementId === "R1")?.status).toBe("supported");
	});

	it("leaves out a thin project that isn't particularly relevant and gives its space to the roles", async () => {
		const profile = consultantProfile();
		const founder = profile.entries.find((item) => item.id === "e-founder");
		founder?.achievements.push(
			achievement(
				"a-appeal",
				"e-founder",
				"Wrote the year-end donor appeal letters and email series for a community nonprofit, raising $30,000",
				{ skills: ["Copywriting", "Email marketing"] },
			),
			achievement(
				"a-stories",
				"e-founder",
				"Interviewed volunteers and wrote impact stories for a charity's website and social media channels",
				{ skills: ["Storytelling", "Social media"] },
			),
		);
		const { plan } = await select(communicationsJob(), profile);
		// The civic project would show one loosely related bullet.
		expect(entryOf(plan, "e-civic")).toMatchObject({
			include: false,
			reason: expect.stringMatching(/Only one bullet/),
		});
		const lead = entryOf(plan, "e-founder");
		expect(lead?.achievements.filter((item) => item.include).length).toBeGreaterThan(5);
		expect(lead?.achievements.find((item) => item.achievementId === "a-appeal")?.include).toBe(true);
		expect(lead?.achievements.find((item) => item.achievementId === "a-stories")?.include).toBe(true);
		// Loosely related work isn't used as padding.
		expect(lead?.achievements.find((item) => item.achievementId === "a-plugin")?.include).toBe(false);
		// A single bullet that is strongly relevant keeps its volunteer role.
		expect(entryOf(plan, "e-volunteer")?.include).toBe(true);
	});

	it("web development: technical projects get the emphasis", async () => {
		const { plan } = await select(webDevJob());
		const chosen = included(plan);
		expect(chosen.entries).toEqual(expect.arrayContaining(["e-founder", "e-civic"]));
		expect(chosen.achievements).toEqual(expect.arrayContaining(["a-plugin", "a-civic", "a-scraper", "a-portal"]));
		expect(chosen.achievements).not.toContain("a-newsletter");
		expect(chosen.entries).not.toContain("e-retail");
		expect(plan.sections.indexOf("projects")).toBeGreaterThan(-1);
		expect(chosen.skills).toEqual(expect.arrayContaining(["s-react", "s-ts", "s-wp", "s-php"]));
		expect(chosen.skills).not.toContain("s-media");
	});

	it("project management: delivery, coordination, stakeholders and measured scope come first", async () => {
		const { plan } = await select(projectManagementJob());
		const founder = entryOf(plan, "e-founder");
		expect(founder?.achievements[0]?.achievementId).toBe("a-conference");
		expect(included(plan).achievements).toEqual(expect.arrayContaining(["a-conference", "a-discovery", "a-events"]));
		expect(entryOf(plan, "e-pmp")?.include).toBe(true);
		const certification = plan.coverage.find((item) => item.requirementId === "R4");
		expect(certification?.status).not.toBe("supported");
	});

	it("keeps a highly relevant older position eligible", async () => {
		const profile = consultantProfile();
		// A recent, unrelated job, and a communications role from fifteen years ago.
		profile.entries.unshift(
			entry("e-warehouse", "position", "Shift Supervisor", "Northern Logistics", "2021-01", null, [
				["a-shift", "Scheduled a team of 12 warehouse staff across three shifts"],
			]),
			entry("e-old-comms", "position", "Communications Officer", "Lakeshore Children's Charity", "2008-01", "2011-05", [
				[
					"a-old-campaign",
					"Ran the charity's annual donor appeal campaign across email, mail and social media, raising $210,000",
					{ metrics: [{ value: "210,000", unit: "$", label: "raised" }], skills: ["Email marketing"] },
				],
				["a-old-press", "Wrote press releases and media pitches for the nonprofit's events"],
			]),
		);
		profile.entries = profile.entries.filter((item) => item.id !== "e-comms" && item.id !== "e-founder");
		const { plan } = await select(communicationsJob(), profile);
		const old = entryOf(plan, "e-old-comms");
		expect(old?.include).toBe(true);
		expect(old?.reason).toMatch(/Older/);
		expect(old?.achievements[0]?.achievementId).toBe("a-old-campaign");
		// Reverse chronological order is kept: the 2008 role is listed after the current one.
		const order = plan.entries.map((item) => item.entryId);
		expect(order.indexOf("e-warehouse")).toBeLessThan(order.indexOf("e-old-comms"));
	});

	it("flags incomplete and conflicting records, and respects hidden, switched-off and private records", async () => {
		const profile = consultantProfile();
		profile.entries.push(
			entry(
				"e-comms-dup",
				"position",
				"Communications Coordinator",
				"Riverside Community Foundation",
				"2016-01",
				"2019-06",
				[["a-annual-dup", "Produced the foundation's annual report and impact stories, distributed to 2,500 donors"]],
			),
			entry("e-undated", "position", "Contract Writer", "Freelance", null, null, [
				["a-writer", "Wrote grant applications for small charities"],
			]),
		);
		const founder = profile.entries.find((item) => item.id === "e-founder");
		const hidden = founder?.achievements.find((item) => item.id === "a-newsletter");
		if (hidden) hidden.hidden = true;
		profile.skills.push(skill("s-dup", "Wordpress Development", "Web", ["WP"]));
		const blocked = new Map([
			["a-campaign", "Switched off in Career Knowledge"],
			["a-media", "Private to another application"],
		]);
		const { plan } = await select(communicationsJob(), profile, { blocked });
		expect(plan.warnings.join("\n")).toMatch(/appears twice with different dates/);
		expect(plan.warnings.join("\n")).toMatch(/has no start date/);
		expect(plan.warnings.join("\n")).toMatch(/read almost the same/);
		expect(plan.warnings.join("\n")).toMatch(/"WP" names two skills/);
		expect(plan.unavailable).toEqual(
			expect.arrayContaining([
				{ id: "a-newsletter", kind: "achievement", reason: "Hidden in your profile" },
				{ id: "a-campaign", kind: "achievement", reason: "Switched off in Career Knowledge" },
				{ id: "a-media", kind: "achievement", reason: "Private to another application" },
			]),
		);
		const everywhere = plan.entries.flatMap((item) => item.achievements.map((a) => a.achievementId));
		expect(everywhere).not.toContain("a-campaign");
		expect(everywhere).not.toContain("a-newsletter");
		// Only one of the duplicate annual-report achievements is used.
		const chosen = included(plan).achievements;
		expect(chosen.filter((id) => id === "a-annual" || id === "a-annual-dup")).toHaveLength(1);
	});

	it("finds relevant records deep in a large profile and sends them to the AI", async () => {
		const profile = consultantProfile();
		const filler = Array.from({ length: 30 }, (_, index) =>
			entry(
				`e-f${index}`,
				"position",
				`Operations Clerk ${index}`,
				`Depot ${index}`,
				`20${String(index % 10).padStart(2, "0")}-01`,
				`20${String(index % 10).padStart(2, "0")}-12`,
				Array.from(
					{ length: 14 },
					(_, n) =>
						[`a-f${index}-${n}`, `Processed shipping paperwork batch ${index}-${n} and filed inventory forms`] as [
							string,
							string,
						],
				),
			),
		);
		// 420 unrelated achievements first; the relevant ones come last, as in a long, unsorted record.
		profile.entries = [...filler, ...profile.entries];
		const analysis = webDevJob();
		const { eligible, ranked, short } = (() => {
			const eligible = eligibleProfile(profile, new Map()).profile;
			const requirements = requirementTerms(analysis, eligible.skills);
			const ranked = rankEvidence(eligible, { analysis, requirements, emphasis: new Set(), now });
			return { eligible, ranked, short: shortlist(ranked, requirements) };
		})();
		expect(eligible.entries.reduce((sum, item) => sum + item.achievements.length, 0)).toBeGreaterThan(430);
		const ids = short.map((candidate) => candidate.achievement.id);
		expect(ids).toEqual(expect.arrayContaining(["a-plugin", "a-civic", "a-scraper", "a-portal", "a-a11y"]));
		expect(short.length).toBeLessThan(ranked.length);
		const { plan, prompt } = await select(analysis, profile);
		expect(prompt).toContain("Built a React and TypeScript web app");
		expect(prompt).toMatch(/weaker achievements from these entries were not shown/);
		expect(included(plan).achievements).toEqual(expect.arrayContaining(["a-plugin", "a-civic"]));
		expect(included(plan).entries.filter((id) => /^e-f\d/.test(id))).toEqual([]);
		expect(plan.totals.achievements).toBeGreaterThan(400);
		expect(plan.totals.includedAchievements).toBeLessThan(20);
	});

	it("uses the AI review, but never lets it cite records that don't exist", async () => {
		const { plan } = await select(communicationsJob(), consultantProfile(), {
			review: (prompt) => ({
				positioning: "A nonprofit communicator who also builds the tools.",
				entries: [{ id: "E99", include: true, reason: "made up" }],
				achievements: [
					{
						id: keyOf(prompt, "food bank"),
						relevance: 3,
						requirements: ["R1", "R4", "R99"],
						reason: "Donor campaign with results",
					},
					{ id: keyOf(prompt, "WCAG"), relevance: 0, requirements: [], reason: "Not about communications" },
					{ id: "A999", relevance: 3, requirements: ["R1"], reason: "invented" },
				],
				skills: [],
			}),
		});
		expect(plan.source).toBe("ai");
		expect(plan.positioning).toMatch(/nonprofit communicator/);
		const campaign = entryOf(plan, "e-founder")?.achievements.find((item) => item.achievementId === "a-campaign");
		expect(campaign).toMatchObject({ include: true, reason: "Donor campaign with results", score: { aiRelevance: 3 } });
		expect(campaign?.requirementIds).not.toContain("R99");
		expect(entryOf(plan, "e-founder")?.achievements.find((item) => item.achievementId === "a-a11y")?.include).toBe(
			false,
		);
	});

	it("gives the same selection for the same input, and nearly the same when the AI's ratings wobble", async () => {
		const first = await select(projectManagementJob());
		const second = await select(projectManagementJob());
		const strip = (plan: ResumeSelectionPlan) => ({ ...plan, createdAt: "" });
		expect(strip(second.plan)).toEqual(strip(first.plan));

		const ratings =
			(shift: number) =>
			(prompt: string): ReviewOutput => ({
				positioning: "",
				entries: [],
				skills: [],
				achievements: [...prompt.matchAll(/\b(A\d+):/g)].map(([, id], index) => ({
					id: id ?? "",
					// The same judgments, with one point of disagreement on every third item.
					relevance: Math.max(
						0,
						Math.min(
							3,
							(prompt.includes(`${id}: Delivered`) ||
							prompt.includes(`${id}: Led discovery`) ||
							prompt.includes(`${id}: Coordinated`)
								? 3
								: 1) + (index % 3 === 0 ? shift : 0),
						),
					),
					requirements: [],
					reason: "",
				})),
			});
		const a = included(
			(await select(projectManagementJob(), consultantProfile(), { review: ratings(0) })).plan,
		).achievements;
		const b = included(
			(await select(projectManagementJob(), consultantProfile(), { review: ratings(-1) })).plan,
		).achievements;
		const shared = a.filter((id) => b.includes(id)).length;
		// Lowering every third rating only drops borderline items; nothing new appears.
		expect(shared / new Set([...a, ...b]).size).toBeGreaterThanOrEqual(0.7);
		expect(b.every((id) => a.includes(id))).toBe(true);
		expect(b).toEqual(expect.arrayContaining(["a-conference", "a-discovery"]));
	});
});

describe("reviewing a plan", () => {
	it("applies include and order changes without touching records, and carries them into a new proposal", async () => {
		const { plan, proposed } = await select(communicationsJob());
		const founder = entryOf(plan, "e-founder");
		const order = founder?.achievements.map((item) => item.achievementId) ?? [];
		const edited = applyEdit(
			plan,
			proposed,
			{
				applicationId: "app",
				entries: [
					{
						entryId: "e-founder",
						include: true,
						achievements: [
							{ achievementId: "a-plugin", include: true },
							...order
								.filter((id) => id !== "a-plugin")
								.map((id) => ({ achievementId: id, include: id === "a-campaign" })),
						],
					},
					{ entryId: "e-retail", include: true, achievements: [] },
				],
				skills: [{ skillId: "s-php", include: true }],
			},
			communicationsJob(),
		);
		const editedFounder = entryOf(edited, "e-founder");
		expect(editedFounder?.achievements.filter((item) => item.include).map((item) => item.achievementId)).toEqual([
			"a-plugin",
			"a-campaign",
		]);
		expect(editedFounder?.achievements[0]).toMatchObject({
			userEdited: true,
			text: expect.stringContaining("WordPress plugin"),
		});
		expect(entryOf(edited, "e-retail")).toMatchObject({ include: true, userEdited: true });
		expect(edited.skills.find((item) => item.skillId === "s-php")).toMatchObject({ include: true, userEdited: true });
		expect(edited.totals.includedEntries).toBe(plan.totals.includedEntries + 1);

		const again = await select(communicationsJob(), consultantProfile(), { previous: edited });
		expect(entryOf(again.plan, "e-retail")?.include).toBe(true);
		expect(entryOf(again.plan, "e-founder")?.achievements[0]?.achievementId).toBe("a-plugin");
		expect(entryOf(again.proposed, "e-retail")?.include).toBe(false);
	});

	it("reports requirements without verified evidence as gaps", async () => {
		const analysis = analysisOf({
			requirements: [
				...communicationsJob().requirements.map(({ id: _id, ...rest }) => rest),
				requirement("French language fluency", 4, "mandatory", ["bilingual"]),
			],
		});
		const { plan } = await select(analysis);
		const french = analysis.requirements.find((item) => item.text.startsWith("French"));
		expect(plan.coverage.find((item) => item.requirementId === french?.id)).toMatchObject({
			status: "gap",
			achievementIds: [],
			available: [],
		});
	});
});
