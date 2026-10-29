import type { MasterProfile } from "../service";
import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { parseResumeDataForWrite } from "@reactive-resume/schema/resume/write";
import { buildResume, bulletsHtml, chooseWording } from "./build";
import { checkGrounded, numbersIn } from "./grounding";
import { buildCatalog, modelOutputSchema, resolveOutput } from "./prompt";

const stamp = { createdAt: new Date(0), updatedAt: new Date(0), userId: "u", sortOrder: 0, hidden: false };

const achievement = (
	id: string,
	entryId: string | null,
	text: string,
	extra: Partial<MasterProfile["standalone"][number]> = {},
) => ({
	...stamp,
	id,
	entryId,
	text,
	metrics: [],
	skills: [],
	tags: [],
	variants: [],
	core: false,
	...extra,
});

const entry = (
	id: string,
	kind: MasterProfile["entries"][number]["kind"],
	title: string,
	dates: { startDate: string | null; endDate: string | null },
	achievements: MasterProfile["standalone"],
	extra: Partial<MasterProfile["entries"][number]> = {},
) => ({
	...stamp,
	id,
	kind,
	title,
	organization: "",
	location: "",
	url: "",
	summary: "",
	tags: [],
	...dates,
	achievements,
	...extra,
});

const profile: MasterProfile = {
	entries: [
		entry(
			"e-founder",
			"position",
			"Founder",
			{ startDate: "2019-03", endDate: null },
			[
				achievement("a-portal", "e-founder", "Rebuilt the volunteer portal, cutting admin time by 40%", {
					metrics: [{ value: "40", unit: "%", label: "less admin time" }],
					variants: ["Cut coordinator admin time 40% with a rebuilt WordPress portal"],
				}),
				achievement("a-clients", "e-founder", "Grew the client roster to 12 nonprofits", { core: true }),
				achievement("a-hidden", "e-founder", "Secret thing", { hidden: true }),
			],
			{ organization: "Countdown Creative", location: "Peterborough, ON" },
		),
		entry("e-old", "position", "Analyst", { startDate: "2008", endDate: "2010" }, [
			achievement("a-old", "e-old", "Built monthly reports"),
		]),
		entry("e-bba", "education", "BBA, Entrepreneurship", { startDate: "2012", endDate: "2016" }, [], {
			organization: "Trent University",
		}),
		entry("e-side", "project", "Civic app", { startDate: "2025", endDate: null }, [
			achievement("a-civic", "e-side", "Catalogued 300 council votes"),
		]),
	],
	standalone: [achievement("a-loose", null, "Spoke at a conference")],
	skills: [
		{ ...stamp, id: "s-wp", name: "WordPress", category: "Web", level: null, years: 8, aliases: [] },
		{ ...stamp, id: "s-pm", name: "Project management", category: "", level: null, years: null, aliases: ["PM"] },
		{ ...stamp, id: "s-x", name: "Hidden skill", category: "", level: null, years: null, aliases: [], hidden: true },
	],
};

const now = new Date("2026-10-29");

describe("grounding", () => {
	it("normalizes numbers", () => {
		expect([...numbersIn("Cut 1,200 tickets by 40% in 3.0 months")]).toEqual(["1200", "40", "3"]);
	});

	it("rejects introduced numbers in digits or words", () => {
		const source = ["Cut admin time by 40%"];
		expect(checkGrounded("Reduced admin time 40%", source)).toEqual({ ok: true });
		expect(checkGrounded("Reduced admin time 45%", source)).toMatchObject({ ok: false });
		expect(checkGrounded("Doubled throughput", source)).toMatchObject({ ok: false });
		expect(checkGrounded("Led one of the projects", source)).toEqual({ ok: true });
		expect(checkGrounded("Trained three teams", ["Trained 3 teams"])).toEqual({ ok: true });
	});

	it("rejects rewrites far longer than the source", () => {
		expect(checkGrounded("x".repeat(500), ["short"], 100)).toMatchObject({ ok: false, reason: "too long" });
	});
});

describe("chooseWording", () => {
	const portal = profile.entries[0]?.achievements[0];
	if (!portal) throw new Error("fixture: missing portal achievement");

	it("keeps a grounded rephrase, falls back on an invented number", () => {
		const warnings: string[] = [];
		expect(
			chooseWording(portal, "Reduced coordinator admin time 40% by rebuilding the portal", "rephrase", warnings),
		).toMatchObject({
			source: "rephrased",
		});
		expect(chooseWording(portal, "Reduced admin time 60% for 5,000 volunteers", "rephrase", warnings)).toEqual({
			text: portal.text,
			source: "original",
		});
		expect(warnings).toHaveLength(1);
	});

	it("uses approved variants verbatim and ignores rewording in verbatim mode", () => {
		expect(chooseWording(portal, portal.variants[0] ?? "", "verbatim", [])).toMatchObject({ source: "variant" });
		expect(chooseWording(portal, "Totally new words", "verbatim", [])).toEqual({
			text: portal.text,
			source: "original",
		});
	});
});

describe("buildResume", () => {
	it("places chosen bullets under their entries and keeps the base resume's details", () => {
		const base = { ...defaultResumeData, basics: { ...defaultResumeData.basics, name: "Lucas" } };
		const result = buildResume({
			base,
			profile,
			mode: "rephrase",
			now,
			selection: {
				achievements: [
					{ id: "a-civic", text: "Catalogued 300 council votes for residents" },
					{ id: "a-portal", text: "Reduced admin time 40% with a rebuilt portal" },
					{ id: "a-hidden", text: "Should never appear" },
					{ id: "unknown:A99", text: "Made up" },
					{ id: "a-loose", text: "Spoke at a conference" },
				],
				skills: ["s-pm"],
				summary: "Web consultant who cut admin time by 40% for nonprofits.",
			},
		});

		expect(result.data.basics.name).toBe("Lucas");
		const experience = result.data.sections.experience.items;
		// The 2008–2010 role is older than ten years and had nothing chosen, so it's left out.
		expect(experience.map((item) => item.position)).toEqual(["Founder"]);
		expect(experience[0]?.description).toContain("Reduced admin time 40%");
		// Always-include achievement joins the picks.
		expect(experience[0]?.description).toContain("12 nonprofits");
		expect(experience[0]?.description).not.toContain("Secret");
		expect(experience[0]?.dates).toEqual({ start: "2019-03", end: null, present: true });

		expect(result.data.sections.projects.items.map((item) => item.name)).toEqual(["Civic app"]);
		expect(result.data.sections.education.items[0]).toMatchObject({
			school: "Trent University",
			degree: "BBA, Entrepreneurship",
		});

		// Skills: picked first, hidden left out, grouped by category.
		expect(result.data.sections.skills.items.map((item) => [item.name, item.keywords])).toEqual([
			["Skills", ["Project management"]],
			["Web", ["WordPress"]],
		]);

		expect(result.summaryUsed).toBe(true);
		expect(result.bullets.map((bullet) => bullet.achievementId)).toEqual(["a-portal", "a-clients", "a-civic"]);
		expect(result.warnings.join(" ")).toMatch(/aren't attached/);
		expect(result.warnings.join(" ")).toMatch(/Ignored 2/);

		// The result is valid resume data once its date text is written.
		expect(() => parseResumeDataForWrite(result.data)).not.toThrow();
	});

	it("drops a summary with a number the placed evidence doesn't support", () => {
		const result = buildResume({
			base: defaultResumeData,
			profile,
			mode: "rephrase",
			now,
			selection: { achievements: [{ id: "a-portal", text: "" }], skills: [], summary: "Leader of 50 people." },
		});
		expect(result.summaryUsed).toBe(false);
		expect(result.data.summary).toEqual(defaultResumeData.summary);
	});

	it("empties custom sections the profile now supplies, keeping others", () => {
		const base = structuredClone(defaultResumeData);
		const section = {
			icon: "",
			columns: 1,
			hidden: false,
			showHeading: true,
			keepTogether: false,
			startOnNewPage: false,
		};
		base.customSections = [
			{ ...section, id: "older", title: "Earlier experience", type: "experience", items: [{ id: "x" }] },
			{ ...section, id: "talks", title: "Talks", type: "publications", items: [{ id: "y" }] },
		] as typeof base.customSections;
		const result = buildResume({
			base,
			profile,
			mode: "verbatim",
			now,
			selection: { achievements: [{ id: "a-portal", text: "" }], skills: [], summary: "" },
		});
		expect(result.data.customSections.map((custom) => [custom.id, custom.hidden, custom.items.length])).toEqual([
			["older", true, 0],
			["talks", false, 1],
		]);
	});

	it("escapes HTML in bullets", () => {
		expect(bulletsHtml(["<script>&"])).toBe("<ul><li><p>&lt;script&gt;&amp;</p></li></ul>");
	});
});

describe("catalog and model output", () => {
	it("gives visible items short ids and maps them back, flagging made-up ids", () => {
		const catalog = buildCatalog(profile);
		expect(catalog.text).not.toContain("Secret thing");
		expect(catalog.text).not.toContain("Hidden skill");
		expect(catalog.text).toContain("approved variant:");

		const output = modelOutputSchema.parse({
			requirements: [{ requirement: "WordPress", ids: ["a1", "S1", "A404"], strength: "strong" }, { bogus: true }],
			achievements: [{ id: "A1", text: "x" }, { id: "A404", text: "y" }, "garbage"],
			skills: ["S1", "S404"],
			summary: 42,
		});
		const { selection, coverage } = resolveOutput(output, catalog);
		expect(selection.achievements).toEqual([
			{ id: "a-portal", text: "x" },
			{ id: "unknown:A404", text: "y" },
		]);
		expect(selection.skills).toEqual(["s-wp"]);
		expect(selection.summary).toBe("");
		expect(coverage).toEqual([
			{ requirement: "WordPress", strength: "strong", achievementIds: ["a-portal"], skillIds: ["s-wp"] },
		]);
	});
});
