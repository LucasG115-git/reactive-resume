import type { AskModel } from "../selection/model";
import type { MasterProfile } from "../service";
import type { WriterOutput } from "./write";
import type { ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_WRITING_RULES } from "@reactive-resume/schema/resume-writing";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { buildResume, orderSections } from "../assemble/build";
import { communicationsJob, consultantProfile, projectManagementJob, skill, webDevJob } from "../selection/fixtures";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { checkResume, htmlText } from "./checks";
import { keepsQualifiers, introducedTools } from "./grounding";
import { writeFromPlan } from "./service";
import { chooseSkills, groupByCategory, validateGroups } from "./skills";
import { acceptWriting, limitSentences, writerPrompt } from "./write";

const now = new Date("2026-11-01T00:00:00Z");
const rules = DEFAULT_WRITING_RULES;
type Analysis = ReturnType<typeof communicationsJob>;

async function planFor(analysis: Analysis, profile: MasterProfile = consultantProfile()) {
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
	return plan;
}

const included = (plan: ResumeSelectionPlan) =>
	plan.entries.flatMap((entry) => (entry.include ? entry.achievements.filter((item) => item.include) : []));

/** A stand-in writer: tightens each bullet a little, writes a grounded summary, and groups skills by kind. */
const writer =
	(overrides: Partial<WriterOutput> = {}, edit = (text: string) => text): AskModel =>
	async ({ prompt, schema }) => {
		const bullets = [...prompt.matchAll(/^\s+(A\d+): (.+?)(?: \[|$)/gm)].map(([, id, text]) => ({
			id: id ?? "",
			text: edit(text ?? ""),
		}));
		const skills = [...prompt.matchAll(/^\s+(S\d+): (.+)$/gm)].map(([, id]) => id ?? "");
		const half = Math.ceil(skills.length / 2);
		return {
			model: "stub/writer",
			output: schema.parse({
				headline: "Nonprofit Founder & Principal",
				summary:
					"Founder of a web consultancy for nonprofits. Rebuilt a WordPress volunteer portal and delivered accessible sites. Works closely with boards and staff.",
				bullets,
				skillGroups: [
					{ name: "Digital Platforms", skills: skills.slice(0, half) },
					{ name: "Delivery & Communications", skills: skills.slice(half) },
				],
				...overrides,
			}),
		};
	};

async function assemble(analysis: Analysis, ask: AskModel, profile = consultantProfile(), plan?: ResumeSelectionPlan) {
	const selected = plan ?? (await planFor(analysis, profile));
	const written = await writeFromPlan({ userId: "u", plan: selected, analysis, profile, rules, mode: "rephrase", ask });
	const base = structuredClone(defaultResumeData);
	base.basics.name = "Avery Example";
	base.basics.email = "avery@example.test";
	base.basics.phone = "555-0100";
	base.basics.location = "Peterborough, ON";
	const built = buildResume({
		base,
		profile,
		plan: selected,
		mode: "rephrase",
		now,
		selection: {
			achievements: [...written.bullets].map(([id, bullet]) => ({ id, text: bullet.text })),
			skills: written.skills.map((item) => item.id),
			summary: written.summary,
		},
		writing: { headline: written.headline, skillGroups: written.skillGroups },
	});
	const checks = checkResume({
		data: built.data,
		bullets: built.bullets,
		placements: built.placements,
		plan: selected,
		profile,
		analysis,
		rules,
		headline: written.headline,
		now,
	});
	return { plan: selected, written, built, checks };
}

describe("skills", () => {
	it("lists relevant, evidenced skills, without overlaps or generic soft skills, within the limit", async () => {
		const profile = consultantProfile();
		profile.skills.push(
			skill("s-wpdev", "WordPress Development", "Web"),
			skill("s-comm", "Communication", "Soft skills"),
			skill("s-lead", "Leadership"),
		);
		const plan = await planFor(webDevJob(), profile);
		for (const item of plan.skills) if (["s-wpdev", "s-comm"].includes(item.skillId)) item.include = true;
		const { skills, leftOut } = chooseSkills(profile, plan, rules);
		const names = skills.map((item) => item.name);
		expect(names).toEqual(expect.arrayContaining(["WordPress", "PHP", "React", "TypeScript"]));
		expect(names).not.toContain("WordPress Development");
		expect(names).not.toContain("Communication");
		expect(names).not.toContain("Media relations");
		expect(skills.length).toBeLessThanOrEqual(rules.skills.max);
		expect(leftOut).toEqual(
			expect.arrayContaining([
				{ skillId: "s-wpdev", name: "WordPress Development", reason: "Overlaps with WordPress" },
				{ skillId: "s-comm", name: "Communication", reason: "A soft skill: shown through your achievements instead" },
			]),
		);
	});

	it("keeps a soft skill the user chose, and respects skills they left out", async () => {
		const profile = consultantProfile();
		profile.skills.push(skill("s-comm", "Communication"));
		const plan = await planFor(communicationsJob(), profile);
		for (const item of plan.skills) {
			if (item.skillId === "s-comm") Object.assign(item, { include: true, userEdited: true });
			if (item.skillId === "s-copy") Object.assign(item, { include: false, userEdited: true });
		}
		const names = chooseSkills(profile, plan, rules).skills.map((item) => item.name);
		expect(names[0]).toBe("Communication");
		expect(names).not.toContain("Copywriting");
	});

	it("accepts profession-specific groups and falls back to the profile's categories otherwise", () => {
		const skills = consultantProfile().skills.slice(0, 6);
		const ids = skills.map((item) => item.id);
		expect(
			validateGroups(
				[
					{ name: "Web Platforms", skillIds: ids.slice(0, 3) },
					{ name: "Front-end", skillIds: ids.slice(3) },
				],
				skills,
				rules,
			),
		).toHaveLength(2);
		expect(validateGroups([{ name: "Skills", skillIds: ids }], skills, rules)).toBeNull();
		expect(
			validateGroups(
				[
					{ name: "A", skillIds: ids.slice(0, 1) },
					{ name: "B", skillIds: [] },
				],
				skills,
				rules,
			),
		).toBeNull();
		const five = groupByCategory(
			["One", "Two", "Three", "Four", "Five"].map((category, index) => skill(`s${index}`, `Skill ${index}`, category)),
			rules,
		);
		expect(five.map((group) => group.name)).toEqual(["One", "Two", "Three", "Additional skills"]);
	});
});

describe("accepting the writer's wording", () => {
	it("keeps honest qualifiers and rejects invented tools", () => {
		expect(keepsQualifiers("Raised about $40,000", "Raised $40,000")).toBe(false);
		expect(keepsQualifiers("Raised about $40,000", "Raised nearly $40,000")).toBe(true);
		expect(introducedTools("Built the site in WordPress and React", ["Built the site in WordPress"], [])).toEqual([
			"react",
		]);
	});

	it("checks every bullet, the headline and the summary against the record", async () => {
		const profile = consultantProfile();
		const portal = profile.entries[0]?.achievements.find((item) => item.id === "a-portal");
		if (portal)
			portal.text = "Rebuilt a WordPress volunteer portal for about 300 volunteers, cutting admin time by 40%";
		const plan = await planFor(webDevJob(), profile);
		const { prompt, keys } = writerPrompt({
			plan,
			analysis: webDevJob(),
			profile,
			skills: chooseSkills(profile, plan, rules).skills,
			rules,
		});
		const key = (id: string) => [...keys.achievements].find(([, value]) => value === id)?.[0] ?? "";
		expect(prompt).toContain("Canadian English spelling");
		const written = acceptWriting({
			output: {
				headline: "Senior Software Architect",
				summary: "Built 75 web apps. Second sentence. Third sentence. Fourth sentence.",
				bullets: [
					{ id: key("a-portal"), text: "Rebuilt a WordPress portal for 300 volunteers, cutting admin time 40%" },
					{
						id: key("a-plugin"),
						text: "Built a WordPress plugin and REST API integration syncing registrations to Airtable and Salesforce",
					},
					{
						id: key("a-civic"),
						text: "Built a React and TypeScript app cataloguing council votes from public minutes",
					},
				],
				skillGroups: [],
			},
			keys,
			plan,
			profile,
			skills: chooseSkills(profile, plan, rules).skills,
			skillsLeftOut: [],
			rules,
		});
		expect(written.bullets.get("a-portal")?.source).toBe("original");
		expect(written.bullets.get("a-plugin")).toMatchObject({ source: "original" });
		expect(written.bullets.get("a-civic")).toMatchObject({
			source: "rephrased",
			text: expect.stringContaining("cataloguing"),
		});
		// Every planned achievement gets a wording, even ones the writer skipped.
		expect([...written.bullets.keys()].sort()).toEqual(
			included(plan)
				.map((item) => item.achievementId)
				.sort(),
		);
		expect(written.headline).toBe("Founder & Principal");
		expect(written.summary).toBe("");
		expect(written.warnings.join("\n")).toMatch(/dropped a qualifier/);
		expect(written.warnings.join("\n")).toMatch(/named salesforce/);
		expect(written.warnings.join("\n")).toMatch(/latest title as the headline/);
		expect(limitSentences("One. Two. Three. Four.", 3)).toBe("One. Two. Three.");
	});
});

describe("written resumes", () => {
	for (const [name, job] of [
		["communications", communicationsJob],
		["web development", webDevJob],
		["project management", projectManagementJob],
	] as const)
		it(`${name}: follows the plan and passes the checks`, async () => {
			const { plan, written, built, checks } = await assemble(job(), writer());
			expect(checks.findings.filter((finding) => finding.severity === "error")).toEqual([]);
			expect(built.data.basics.headline).toBe("Nonprofit Founder & Principal");
			const experience = built.data.sections.experience.items;
			expect(experience.map((item) => item.position)).toEqual(
				plan.entries.filter((entry) => entry.include && entry.kind === "position").map((entry) => entry.title),
			);
			const skills = built.data.sections.skills.items;
			expect(skills.map((item) => item.name)).toEqual(["Digital Platforms", "Delivery & Communications"]);
			expect(skills.every((item) => item.level === 0 && item.proficiency === "")).toBe(true);
			expect(skills.flatMap((item) => item.keywords).length).toBe(written.skills.length);
			expect(htmlText(built.data.summary.content).split(/(?<=\.)\s/).length).toBeLessThanOrEqual(3);
			expect(checks.stats.estimatedPages).toBeLessThanOrEqual(checks.stats.targetPages);
		});

	it("flags what isn't backed by the record, and wording problems", async () => {
		const { built, plan, written } = await assemble(communicationsJob(), writer());
		const data = structuredClone(built.data);
		const first = data.sections.experience.items[0];
		if (first) {
			first.position = "Director of Communications";
			first.dates = { start: "2015-01", end: null, present: true };
			first.description = first.description.replace(
				"</ul>",
				"<li><p>Won the national communications award</p></li></ul>",
			);
		}
		const group = data.sections.skills.items[0];
		if (group) group.keywords = [...group.keywords, "Salesforce", group.keywords[0] ?? "", "Expert copywriting"];
		data.summary.content =
			"<p>A results-driven, passionate communicator. Campaigns campaigns campaigns campaigns campaigns campaigns.</p>";
		data.picture.url = "https://example.test/me.jpg";
		data.picture.hidden = false;
		const { findings } = checkResume({
			data,
			bullets: built.bullets,
			placements: built.placements,
			plan,
			profile: consultantProfile(),
			analysis: communicationsJob(),
			rules,
			headline: written.headline,
			now,
		});
		const codes = new Set(findings.map((finding) => finding.code));
		for (const code of [
			"title-mismatch",
			"date-mismatch",
			"unsupported-bullet",
			"unsupported-skill",
			"duplicate-skill",
			"cliche",
			"keyword-repetition",
			"personal-details",
		])
			expect(codes).toContain(code);
		expect(findings[0]?.severity).toBe("error");
	});

	it("flags length against the page target without cutting anything", async () => {
		const profile = consultantProfile();
		const founder = profile.entries[0];
		if (founder)
			for (const item of founder.achievements)
				item.text = `${item.text}. ${"Worked with partners on outreach, planning and reporting for the programme. ".repeat(6)}`;
		const { checks, built } = await assemble(communicationsJob(), writer(), profile);
		expect(checks.findings.map((finding) => finding.code)).toEqual(
			expect.arrayContaining(["too-long", "bullet-length"]),
		);
		expect(built.bullets.length).toBeGreaterThan(3);
	});

	it("uses the user's own words when the writer's answer is unusable", async () => {
		const broken: AskModel = async () => {
			const { ORPCError } = await import("@orpc/client");
			throw new ORPCError("INTERNAL_SERVER_ERROR");
		};
		const { written, checks } = await assemble(communicationsJob(), broken);
		expect([...written.bullets.values()].every((bullet) => bullet.source === "original")).toBe(true);
		expect(written.warnings[0]).toMatch(/your own wording/);
		expect(checks.findings.filter((finding) => finding.severity === "error")).toEqual([]);
	});
});

describe("section order", () => {
	it("follows the plan within each column, leaving other items and columns alone", () => {
		const layout = structuredClone(defaultResumeData.metadata.layout);
		const ordered = orderSections(layout, ["summary", "skills", "experience", "projects", "education"]);
		expect(ordered.pages[0]?.main).toEqual([
			"profiles",
			"summary",
			"experience",
			"projects",
			"education",
			"volunteer",
			"references",
		]);
		expect(ordered.pages[0]?.sidebar).toEqual(layout.pages[0]?.sidebar);
	});
});
