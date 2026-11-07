import type { StylePreset } from "@reactive-resume/schema/resume-style";
import { describe, expect, it } from "vite-plus/test";
import { choosePreset, DEFAULT_STYLE_GUIDE } from "@reactive-resume/schema/resume-style";
import { DEFAULT_WRITING_RULES } from "@reactive-resume/schema/resume-writing";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { buildResume, datesOf, yearsOfExperience } from "../assemble/build";
import { estimateWords } from "../selection/fit";
import { achievement, communicationsJob, consultantProfile, entry, skill } from "../selection/fixtures";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { checkResume } from "./checks";
import {
	alignTense,
	dropFiller,
	dropOwnName,
	oddApproximation,
	ownNames,
	restatesHeading,
	shortGroupName,
	isPolitical,
	isPoliticalField,
	sameSite,
	shortenApproximations,
	shortLocation,
	singleHeadline,
	stripEvidenceNotes,
	titleWithOrganization,
	toPastTense,
} from "./hygiene";
import { writeFromPlan } from "./service";
import { mergeThinGroups } from "./skills";

// Lines shaped like real profile records with notes about their evidence (fictional details).
describe("notes about evidence", () => {
	it("drops a clause that reports where a figure came from", () => {
		expect(
			stripEvidenceNotes(
				"Improved site search visibility; internal reporting in March 2024 claimed first place for “food bank near me” at that time.",
			),
		).toEqual({
			text: "Improved site search visibility.",
			removed: ["internal reporting in March 2024 claimed first place for “food bank near me” at that time."],
			doubtful: false,
		});
	});

	it("drops an unverified figure and keeps the achievement", () => {
		expect(
			stripEvidenceNotes(
				"Grew the platform through launch, outreach and UX improvements; an earlier total of approximately 900 users was reported, with timing and definition unverified.",
			).text,
		).toBe("Grew the platform through launch, outreach and UX improvements.");
	});

	it("drops a trailing phrase that undercuts the line, and parenthetical notes", () => {
		expect(
			stripEvidenceNotes("Took extra coursework in Statistics and Design without completing either minor.").text,
		).toBe("Took extra coursework in Statistics and Design.");
		expect(stripEvidenceNotes("Raised $12,000 (unverified, from the board report) in one season.").text).toBe(
			"Raised $12,000 in one season.",
		);
		expect(
			stripEvidenceNotes(
				"Supported onboarding of ~80 additional organizations and claims of pre-populated profiles, based on recollection rather than a verified registration export.",
			).text,
		).toBe("Supported onboarding of ~80 additional organizations and claims of pre-populated profiles.");
	});

	it("flags a line whose main clause is itself unsure, and leaves plain lines alone", () => {
		expect(stripEvidenceNotes("Reportedly increased donations by 20%.").doubtful).toBe(true);
		const plain = "Built reporting dashboards in Power BI; cut monthly close by two days.";
		expect(stripEvidenceNotes(plain)).toEqual({ text: plain, removed: [], doubtful: false });
	});
});

describe("approximations", () => {
	it("writes long hedges briefly and keeps other qualifiers", () => {
		expect(shortenApproximations("Launched approximately 25 websites and approximately five campaigns.")).toBe(
			"Launched ~25 websites and ~5 campaigns.",
		);
		expect(shortenApproximations("Cut costs by roughly 30% for about 40 clients.")).toBe(
			"Cut costs by ~30% for about 40 clients.",
		);
	});
});

describe("tense", () => {
	it("puts opening verbs in the past tense, including irregular and joined ones", () => {
		expect(toPastTense("Manage discovery and testing")).toBe("Managed discovery and testing");
		expect(toPastTense("Implements SEO workflows")).toBe("Implemented SEO workflows");
		expect(toPastTense("Lead a team of four")).toBe("Led a team of four");
		expect(toPastTense("Design and launch campaigns")).toBe("Designed and launched campaigns");
		expect(toPastTense("Customize templates")).toBe("Customized templates");
		expect(toPastTense("Plan events")).toBe("Planned events");
		expect(toPastTense("Delivered 25 sites")).toBe("Delivered 25 sites");
		expect(toPastTense("Website support for clients")).toBe("Website support for clients");
	});

	it("uses one tense per role, keeping a current role written entirely in the present", () => {
		expect(alignTense(["Designed 25 sites", "Manage client work"], true)).toEqual([
			"Designed 25 sites",
			"Managed client work",
		]);
		expect(alignTense(["Manage client work", "Build sites"], true)).toEqual(["Manage client work", "Build sites"]);
		expect(alignTense(["Manage client work", "Build sites"], false)).toEqual(["Managed client work", "Built sites"]);
	});
});

describe("titles, places, links and dates", () => {
	it("doesn't repeat an organization the title already names", () => {
		expect(
			titleWithOrganization(
				"ACM Lakes Chapter — Website and Member Systems",
				"Association of Civic Makers — Lakes Chapter",
			),
		).toBe("ACM Lakes Chapter — Website and Member Systems");
		expect(titleWithOrganization("Volunteer Hub — Website Platform", "Volunteer Hub")).toBe(
			"Volunteer Hub — Website Platform",
		);
		expect(titleWithOrganization("Website Rebuild", "Riverside Food Bank")).toBe(
			"Website Rebuild — Riverside Food Bank",
		);
	});

	it("shortens locations to the header's form", () => {
		expect(shortLocation("Kingston, Ontario, Canada")).toBe("Kingston, ON");
		expect(shortLocation("Portland, Oregon, USA")).toBe("Portland, OR");
		expect(shortLocation("Remote")).toBe("Remote");
	});

	it("recognises the same site", () => {
		expect(sameSite("https://www.example.agency", "example.agency/about")).toBe(true);
		expect(sameSite("https://example.org", "https://other.org")).toBe(false);
	});

	it("shows both dates at one precision", () => {
		expect(datesOf({ startDate: "2026", endDate: "2026-10" })).toEqual({ start: "2026", end: null, present: false });
		expect(datesOf({ startDate: "2024", endDate: "2025-06" })).toEqual({ start: "2024", end: "2025", present: false });
		expect(datesOf({ startDate: "2023-03", endDate: null })).toEqual({ start: "2023-03", end: null, present: true });
	});

	it("keeps one identity in the headline", () => {
		expect(singleHeadline("Web Developer and Founder | Digital Marketing and Project Management")).toBe(
			"Web Developer and Founder",
		);
		expect(singleHeadline("Digital Project Manager")).toBe("Digital Project Manager");
	});
});

describe("sensitive content", () => {
	it("recognises political work, and postings where it's relevant", () => {
		expect(isPolitical("2026 City Council Campaign — Riverside Ward")).toBe(true);
		expect(isPolitical("Prepared get-out-the-vote communications")).toBe(true);
		expect(isPolitical("Ran an email marketing campaign for a food bank")).toBe(false);
		expect(isPoliticalField("Policy Analyst, Ministry of Municipal Affairs")).toBe(true);
		expect(isPoliticalField("Digital Marketing Coordinator at a software company")).toBe(false);
	});
});

describe("skill groups", () => {
	it("merges one-skill groups into another", () => {
		const groups = mergeThinGroups([
			{ name: "Communications & Marketing", skillIds: ["a", "b", "c"] },
			{ name: "Analytics", skillIds: ["d", "e"] },
			{ name: "Project Delivery", skillIds: ["f"] },
		]);
		expect(groups).toEqual([
			{ name: "Communications & Marketing", skillIds: ["a", "b", "c"] },
			{ name: "Analytics", skillIds: ["d", "e", "f"] },
		]);
		expect(DEFAULT_WRITING_RULES.pages.experiencedYears).toBe(10);
	});
});

describe("a tailored resume from a record with these problems", () => {
	const now = new Date("2026-11-01T00:00:00Z");

	async function assemble(analysis = communicationsJob()) {
		const profile = consultantProfile();
		profile.entries.push(
			entry(
				"campaign",
				"project",
				"2026 City Council Campaign — Riverside Ward",
				"Independent municipal campaign",
				"2026",
				"2026-10",
				[
					["a-gotv", "Wrote voter-information and get-out-the-vote email communications for 3,000 subscribers"],
					["a-policy", "Wrote newsletters explaining housing and transit policy to residents"],
				],
			),
		);
		const founder = profile.entries.find((item) => item.kind === "position" && !item.endDate);
		if (founder) {
			founder.location = "Northbrook, Ontario, Canada";
			founder.url = "https://avery.example";
			founder.achievements.push(
				achievement(
					"a-hedge",
					founder.id,
					"Manage email campaigns for approximately five nonprofit clients; reported open rates were unverified at that time",
				),
			);
		}
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
		const hedge = plan.entries.flatMap((item) => item.achievements).find((item) => item.achievementId === "a-hedge");
		if (hedge) hedge.include = true;
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
		const base = structuredClone(defaultResumeData);
		base.basics.website = { url: "https://avery.example", label: "" };
		const built = buildResume({
			base,
			profile,
			plan,
			mode: "verbatim",
			now,
			selection: {
				achievements: [...written.bullets].map(([id, bullet]) => ({ id, text: bullet.text })),
				skills: [],
				summary: "",
			},
			writing: { headline: "Web Developer | Digital Marketing", skillGroups: written.skillGroups },
		});
		const checks = checkResume({
			data: built.data,
			bullets: built.bullets,
			placements: built.placements,
			plan,
			profile,
			analysis,
			rules: DEFAULT_WRITING_RULES,
			headline: built.data.basics.headline,
			evidenceNotes: built.evidenceNotes,
			now,
		});
		return { plan, written, built, checks };
	}

	it("leaves political work off a posting outside politics, with a reason the user can override", async () => {
		const { plan, built } = await assemble();
		const campaign = plan.entries.find((item) => item.entryId === "campaign");
		expect(campaign?.include).toBe(false);
		expect(campaign?.reason).toMatch(/^Political work/);
		expect(JSON.stringify(built.data)).not.toContain("get-out-the-vote");
	});

	it("keeps political work for a job in that field", async () => {
		const job = communicationsJob();
		job.title = "Communications Officer, City Council";
		job.domain = ["municipal government"];
		const { plan } = await assemble(job);
		expect(plan.entries.find((item) => item.entryId === "campaign")?.reason).not.toMatch(/^Political work/);
	});

	it("prints lines without evidence notes, in one tense, with short places and no repeated links", async () => {
		const { built, checks } = await assemble();
		const role = built.data.sections.experience.items.find((item) => item.description.includes("~5 nonprofit"));
		expect(role?.description).toContain("<p>Managed email campaigns for ~5 nonprofit clients</p>");
		expect(role?.location).toBe("Northbrook, ON");
		expect(role?.website.url).toBe("");
		expect(built.data.basics.headline).toBe("Web Developer");
		expect(built.data.sections.education.items.every((item) => item.website.url === "")).toBe(true);
		expect(built.evidenceNotes).toEqual([
			{ achievementId: "a-hedge", removed: ["reported open rates were unverified at that time"], doubtful: false },
		]);
		// Tools the printed bullets name are listed, whatever the posting asked for.
		const { written } = await assemble();
		const printed = built.bullets.map((bullet) => bullet.text).join(" ");
		expect(printed).toContain("WCAG");
		expect(written.skills.map((item) => item.id)).toContain("s-a11y");
		const codes = checks.findings.map((finding) => finding.code);
		expect(codes).toContain("evidence-note");
		expect(codes).not.toContain("tense-mixed");
		expect(codes).not.toContain("date-mismatch");
		expect(codes).not.toContain("headline-list");
	});
});

describe("pitch and polish", () => {
	it("drops filler, the entry's own name, and lines that restate their heading", () => {
		expect(dropFiller("Designed and launched ~25 client websites, with additional projects in development.")).toBe(
			"Designed and launched ~25 client websites.",
		);
		expect(
			dropOwnName(
				"Led discovery, research, design and launch for Volunteer Hub.",
				ownNames({ title: "Volunteer Hub — Website Platform", organization: "Volunteer Hub" }),
			),
		).toBe("Led discovery, research, design and launch.");
		expect(
			restatesHeading(
				"Earned a Bachelor of Business Administration with Entrepreneurship Specialization.",
				"Bachelor of Business Administration (BBA), Entrepreneurship Specialization Riverside University",
			),
		).toBe(true);
		expect(
			restatesHeading("Took extra coursework in Statistics and Design.", "Bachelor of Arts Riverside University"),
		).toBe(false);
	});

	it("flags a hedge on a number that looks exact", () => {
		expect(oddApproximation("Placed ads for ~38 sponsors")).toBe(38);
		expect(oddApproximation("Launched ~25 sites for ~5 clients")).toBeNull();
	});

	it("keeps skill group names short", () => {
		expect(shortGroupName("Communications and Marketing")).toBe("Communications & Marketing");
	});

	it("picks a preset from the posting's field when the title alone doesn't say", () => {
		const guide = {
			...DEFAULT_STYLE_GUIDE,
			presets: [
				...DEFAULT_STYLE_GUIDE.presets,
				{
					...(DEFAULT_STYLE_GUIDE.presets[0] as StylePreset),
					id: "comms",
					name: "Communications",
					keywords: ["communications", "marketing"],
				},
			],
		};
		expect(choosePreset(guide, "Officer, Recruitment").id).toBe("general");
		expect(
			choosePreset(guide, "Officer, Recruitment", null, "a communications role centred on recruitment writing").id,
		).toBe("comms");
	});

	it("fits the proposal to the page target, weakest first, and says what it left out", async () => {
		const profile = consultantProfile();
		const analysis = communicationsJob();
		const loose = {
			...DEFAULT_WRITING_RULES,
			pages: { ...DEFAULT_WRITING_RULES.pages, early: 1, experiencedYears: 30 },
		};
		const select = (rules?: typeof loose) =>
			buildSelection({
				applicationId: "app",
				analysis,
				profile,
				blocked: new Map(),
				emphasis: { text: "", tokens: tokens("") },
				previous: null,
				now: new Date("2026-11-01T00:00:00Z"),
				review: async () => null,
				...(rules ? { rules } : {}),
			});
		const tight = { ...loose, wordsPerPage: 250 };
		const before = (await select()).plan;
		const after = (await select(tight)).plan;
		expect(estimateWords(after, tight)).toBeLessThan(estimateWords(before, tight));
		expect(after.totals.includedAchievements).toBeLessThan(before.totals.includedAchievements);
		const left = after.entries.flatMap((item) => item.achievements).filter((item) => /page target/.test(item.reason));
		expect(left.length).toBeGreaterThan(0);
		expect(after.warnings.some((warning) => /to fit the 1-page target/.test(warning))).toBe(true);
		// Every included position keeps at least one bullet.
		for (const item of after.entries.filter((x) => x.include && x.kind === "position"))
			expect(item.achievements.some((x) => x.include)).toBe(true);
	});

	it("lists skills the bullets show before ones only marked relevant, and drops a skill that repeats its heading", async () => {
		const profile = consultantProfile();
		profile.skills.push(skill("s-comms", "Communications", "Communications"));
		const analysis = communicationsJob();
		const { plan } = await buildSelection({
			applicationId: "app",
			analysis,
			profile,
			blocked: new Map(),
			emphasis: { text: "", tokens: tokens("") },
			previous: null,
			now: new Date("2026-11-01T00:00:00Z"),
			review: async () => null,
		});
		const comms = plan.skills.find((item) => item.skillId === "s-comms");
		if (comms) comms.include = true;
		const written = await writeFromPlan({
			userId: "u",
			plan,
			analysis,
			profile,
			rules: DEFAULT_WRITING_RULES,
			mode: "rephrase",
			ask: async ({ schema, prompt }) => {
				const skills = [...prompt.matchAll(/^\s+(S\d+): (.+)$/gm)];
				const comm = skills.find(([, , name]) => name === "Communications")?.[1];
				const rest = skills.map(([, id]) => id).filter((id) => id !== comm);
				return {
					model: "stub",
					output: schema.parse({
						headline: "",
						summary: "",
						bullets: [],
						skillGroups: [
							{ name: "Communications and Marketing", skills: [comm, ...rest.slice(0, 3)] },
							{ name: "Platforms and Tools", skills: rest.slice(3) },
						],
					}),
				};
			},
		});
		expect(written.skillGroups.map((group) => group.name)).toEqual(["Communications & Marketing", "Platforms & Tools"]);
		expect(written.skills.map((item) => item.id)).not.toContain("s-comms");
		expect(written.skillsLeftOut).toContainEqual(
			expect.objectContaining({ skillId: "s-comms", reason: "Repeats its group's heading" }),
		);
	});
});

describe("summary and fit", () => {
	const now = new Date("2026-11-01T00:00:00Z");

	async function planFor(rules = DEFAULT_WRITING_RULES) {
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
			rules,
		});
		return { profile, analysis, plan };
	}

	it("counts whole years of experience, never rounding up", () => {
		const [first] = consultantProfile().entries;
		if (!first) throw new Error("No entries.");
		const started = (startDate: string) => ({
			entries: [{ ...first, kind: "position" as const, startDate, hidden: false }],
		});
		expect(yearsOfExperience(started("2020-01"), now)).toBe(6);
		expect(yearsOfExperience(started("2019-12"), now)).toBe(6);
		expect(yearsOfExperience(started("2019-10"), now)).toBe(7);
	});

	it("never inherits the base resume's summary when writing for a posting", async () => {
		const { profile, plan } = await planFor();
		const base = structuredClone(defaultResumeData);
		base.summary.content = "<p>Expert in PHP and MySQL with 7+ years of experience.</p>";
		const built = buildResume({
			base,
			profile,
			plan,
			mode: "rephrase",
			now,
			selection: { achievements: [], skills: [], summary: "Seasoned leader with 43 years of experience." },
			writing: { headline: "", skillGroups: [] },
		});
		expect(built.summaryUsed).toBe(false);
		expect(built.data.summary.hidden).toBe(true);
		expect(built.data.summary.content).toBe("");
		expect(built.warnings.some((warning) => warning.startsWith("Left the summary off"))).toBe(true);
	});

	it("keeps the lead role's strongest bullets when fitting to the page", async () => {
		const tight = {
			...DEFAULT_WRITING_RULES,
			wordsPerPage: 230,
			pages: { ...DEFAULT_WRITING_RULES.pages, early: 1, experiencedYears: 30 },
		};
		const { plan } = await planFor(tight);
		const lead = plan.entries.find((item) => item.include && item.kind === "position");
		const proposed = lead?.achievements.length ?? 0;
		expect(lead?.achievements.filter((item) => item.include).length).toBe(Math.min(3, proposed));
	});
});
