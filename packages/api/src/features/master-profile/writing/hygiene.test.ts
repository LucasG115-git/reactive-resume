import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_WRITING_RULES } from "@reactive-resume/schema/resume-writing";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { buildResume, datesOf } from "../assemble/build";
import { achievement, communicationsJob, consultantProfile, entry } from "../selection/fixtures";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { checkResume } from "./checks";
import {
	alignTense,
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
