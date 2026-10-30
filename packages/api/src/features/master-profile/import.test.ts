import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { htmlText, resumeToProfile, splitDescription } from "./import";

const website = { url: "", label: "", inlineLink: false };

describe("splitDescription", () => {
	it("turns list items into bullets and a lead paragraph into a summary", () => {
		expect(
			splitDescription(
				"<p>Agency for nonprofits.</p><ul><li><p>Built 12 sites</p></li><li><p>Cut costs &amp; time</p></li></ul>",
			),
		).toEqual({ bullets: ["Built 12 sites", "Cut costs & time"], summary: "Agency for nonprofits." });
	});

	it("treats several paragraphs as bullets and one as a summary", () => {
		expect(splitDescription("<p>First</p><p>Second</p>")).toEqual({ bullets: ["First", "Second"], summary: "" });
		expect(splitDescription("<p>Only one</p>")).toEqual({ bullets: [], summary: "Only one" });
		expect(splitDescription("")).toEqual({ bullets: [], summary: "" });
	});

	it("decodes entities and line breaks", () => {
		expect(htmlText("A&nbsp;&#39;B&#x27;<br/>C")).toBe("A 'B' C");
	});
});

describe("resumeToProfile", () => {
	it("maps every section, splitting multi-role employers into one entry per role", () => {
		const data = structuredClone(defaultResumeData);
		data.sections.experience.items = [
			{
				id: "x1",
				hidden: false,
				company: "Countdown Creative",
				position: "",
				location: "Peterborough, ON",
				period: "",
				dates: { start: "2019-03", end: null, present: true },
				website,
				description: "",
				roles: [
					{
						id: "r1",
						position: "Founder",
						period: "",
						dates: { start: "2021", end: null, present: true },
						description: "<ul><li><p>Led 12 projects</p></li></ul>",
					},
					{
						id: "r2",
						position: "Developer",
						period: "",
						dates: { start: "2019-03", end: "2020-12", present: false },
						description: "<ul><li><p>Built themes</p></li></ul>",
					},
				],
			},
			{
				id: "x2",
				hidden: true,
				company: "Hidden Co",
				position: "Secret",
				location: "",
				period: "",
				website,
				description: "",
				roles: [],
			},
		];
		data.sections.education.items = [
			{
				id: "e1",
				hidden: false,
				school: "Trent University",
				degree: "BBA",
				area: "Entrepreneurship",
				grade: "",
				location: "",
				period: "",
				dates: { start: "2012", end: "2016", present: false },
				website,
				description: "",
			},
		];
		data.sections.volunteer.items = [
			{
				id: "v1",
				hidden: false,
				organization: "Volunteer Peterborough",
				location: "",
				period: "",
				dates: { start: "2023", end: "2026-06", present: false },
				website,
				description: "<p>Chaired the UX team</p>",
			},
		];
		data.sections.skills.items = [
			{
				id: "s1",
				hidden: false,
				icon: "",
				iconColor: "",
				name: "Web",
				proficiency: "",
				level: 0,
				keywords: ["WordPress", "PHP"],
			},
			{
				id: "s2",
				hidden: false,
				icon: "",
				iconColor: "",
				name: "Facilitation",
				proficiency: "",
				level: 4,
				keywords: [],
			},
			{
				id: "s3",
				hidden: false,
				icon: "",
				iconColor: "",
				name: "Dup",
				proficiency: "",
				level: 0,
				keywords: ["wordpress"],
			},
		];

		const result = resumeToProfile(data);
		expect(
			result.entries.map(({ entry }) => [entry.kind, entry.title, entry.organization, entry.startDate, entry.endDate]),
		).toEqual([
			["position", "Founder", "Countdown Creative", "2021", null],
			["position", "Developer", "Countdown Creative", "2019-03", "2020-12"],
			["education", "BBA, Entrepreneurship", "Trent University", "2012", "2016"],
			["volunteer", "Volunteer Peterborough", "", "2023", "2026-06"],
		]);
		expect(result.entries[0]?.achievements.map((a) => a.text)).toEqual(["Led 12 projects"]);
		// A one-paragraph volunteer description is the achievement itself.
		expect(result.entries[3]?.entry.summary).toBe("");
		expect(result.entries[3]?.achievements.map((a) => a.text)).toEqual(["Chaired the UX team"]);
		expect(result.skills.map((skill) => [skill.name, skill.category, skill.level])).toEqual([
			["WordPress", "Web", null],
			["PHP", "Web", null],
			["Facilitation", "", 4],
		]);
	});

	it("includes visible custom sections of a supported type", () => {
		const data = structuredClone(defaultResumeData);
		const base = { icon: "", columns: 1, hidden: false, showHeading: true, keepTogether: false, startOnNewPage: false };
		data.customSections = [
			{
				...base,
				id: "c1",
				title: "Earlier experience",
				type: "experience",
				items: [
					{
						id: "i1",
						hidden: false,
						company: "Old Co",
						position: "Analyst",
						location: "",
						period: "",
						dates: { start: "2010", end: "2012", present: false },
						website,
						description: "<ul><li>Built reports</li></ul>",
						roles: [],
					},
				],
			},
			{ ...base, id: "c2", title: "Hidden", type: "experience", hidden: true, items: [] },
		] as typeof data.customSections;
		const result = resumeToProfile(data);
		expect(result.entries.map(({ entry }) => entry.organization)).toEqual(["Old Co"]);
		expect(result.entries[0]?.achievements.map((a) => a.text)).toEqual(["Built reports"]);
	});
});

describe("profile files", () => {
	it("accepts the friendly forms: plain-string achievements, numeric years, 'present', skill maps", async () => {
		const { profileFileSchema } = await import("@reactive-resume/schema/master-profile");
		const { profileFileToRecords } = await import("./import");
		const file = profileFileSchema.parse({
			version: 1,
			experience: [
				{
					title: "Founder",
					organization: "Countdown Creative",
					start: "2019-3",
					end: "present",
					achievements: [
						"Built sites for nonprofits",
						{
							text: "Cut admin time by 40%",
							metrics: [{ value: 40, unit: "%", label: "less admin time" }],
							skills: "WordPress, PHP",
							core: true,
						},
					],
				},
			],
			education: [{ organization: "Trent University", title: "BBA, Entrepreneurship", start: 2012, end: 2016 }],
			volunteer: [{ organization: "Volunteer Peterborough" }],
			skills: { "Web development": ["WordPress", "Elementor"], Tools: "Airtable, Make" },
		});
		const records = profileFileToRecords(file);
		expect(
			records.entries.map(({ entry }) => [entry.kind, entry.title, entry.organization, entry.startDate, entry.endDate]),
		).toEqual([
			["position", "Founder", "Countdown Creative", "2019-03", null],
			["education", "BBA, Entrepreneurship", "Trent University", "2012", "2016"],
			["volunteer", "Volunteer Peterborough", "", null, null],
		]);
		expect(records.entries[0]?.achievements).toMatchObject([
			{ text: "Built sites for nonprofits", core: false },
			{
				text: "Cut admin time by 40%",
				metrics: [{ value: "40", unit: "%" }],
				skills: ["WordPress", "PHP"],
				core: true,
			},
		]);
		expect(records.skills.map((skill) => [skill.name, skill.category])).toEqual([
			["WordPress", "Web development"],
			["Elementor", "Web development"],
			["Airtable", "Tools"],
			["Make", "Tools"],
		]);
	});

	it("reports every problem with where it is", async () => {
		const { profileFileSchema } = await import("@reactive-resume/schema/master-profile");
		const { profileFileToRecords, ProfileFileError } = await import("./import");
		expect(profileFileSchema.safeParse({ experience: [{ title: "X", start: "March 2019" }] }).success).toBe(false);
		expect(profileFileSchema.safeParse({ jobs: [] }).success).toBe(false);

		const file = profileFileSchema.parse({
			experience: [{ title: "A", start: "2020", end: "2019" }, { start: "2020" }],
			projects: [{ title: "P", achievements: [""] }],
		});
		let caught: unknown;
		try {
			profileFileToRecords(file);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ProfileFileError);
		expect((caught as InstanceType<typeof ProfileFileError>).problems).toEqual([
			"experience[0].endDate: End date is before start date",
			"experience[1].title: needs a title or an organization",
			"projects[0].achievements[0].text: Too small: expected string to have >=1 characters",
		]);
	});
});
