import type { RouterOutput } from "@/libs/orpc/client";
import { describe, expect, it } from "vite-plus/test";
import { profileSelectionToSections } from "./from-profile";

type MasterProfile = RouterOutput["masterProfile"]["get"];

const profile = {
	entries: [
		{
			id: "e1",
			kind: "position",
			title: "Senior Engineer",
			organization: "Acme",
			location: "Remote",
			url: "https://acme.test",
			startDate: "2020-01",
			endDate: null,
			summary: "Led the platform team.",
			tags: [],
			hidden: false,
			achievements: [
				{
					id: "a1",
					entryId: "e1",
					text: "Cut build times 40%",
					metrics: [],
					skills: [],
					tags: [],
					variants: [],
					core: false,
					hidden: false,
				},
			],
		},
		{
			id: "e2",
			kind: "certification",
			title: "AWS Certified",
			organization: "Amazon",
			location: "",
			url: "",
			startDate: "2021",
			endDate: null,
			summary: "",
			tags: [],
			hidden: false,
			achievements: [],
		},
	],
	standalone: [],
	skills: [
		{
			id: "s1",
			name: "TypeScript",
			category: "Web",
			level: 4,
			years: 5,
			aliases: ["TS"],
			kind: "skill",
			entryIds: ["e1"],
			hidden: false,
		},
		{
			id: "s2",
			name: "Figma",
			category: "",
			level: null,
			years: null,
			aliases: [],
			kind: "tool",
			entryIds: [],
			hidden: false,
		},
	],
} as unknown as MasterProfile;

describe("profileSelectionToSections", () => {
	it("maps a position entry into an experience section with dates and bullets", () => {
		const groups = profileSelectionToSections(profile, { entryIds: new Set(["e1"]), skillIds: new Set() });
		const experience = groups.find((group) => group.type === "experience");
		expect(experience).toBeDefined();
		const entry = experience?.entries[0] as Record<string, unknown>;
		expect(entry.company).toBe("Acme");
		expect(entry.position).toBe("Senior Engineer");
		expect(entry.dates).toMatchObject({ start: "2020-01", end: null, present: true });
		expect(entry.website).toMatchObject({ url: "https://acme.test" });
		expect(entry.description).toContain("<li>Cut build times 40%</li>");
		expect(entry.description).toContain("Led the platform team.");
	});

	it("maps a certification entry into the certifications section", () => {
		const groups = profileSelectionToSections(profile, { entryIds: new Set(["e2"]), skillIds: new Set() });
		const cert = groups.find((group) => group.type === "certifications");
		const entry = cert?.entries[0] as Record<string, unknown>;
		expect(entry.title).toBe("AWS Certified");
		expect(entry.issuer).toBe("Amazon");
		expect(entry.dates).toMatchObject({ start: "2021" });
	});

	it("maps skills with level and keywords, and skips unselected records", () => {
		const groups = profileSelectionToSections(profile, {
			entryIds: new Set(),
			skillIds: new Set(["s1"]),
		});
		expect(groups.map((group) => group.type)).toEqual(["skills"]);
		const skill = groups[0]?.entries[0] as Record<string, unknown>;
		expect(skill.name).toBe("TypeScript");
		expect(skill.level).toBe(4);
		expect(skill.keywords).toEqual(["TS"]);
	});

	it("groups in a stable section order", () => {
		const groups = profileSelectionToSections(profile, {
			entryIds: new Set(["e1", "e2"]),
			skillIds: new Set(["s1", "s2"]),
		});
		expect(groups.map((group) => group.type)).toEqual(["experience", "certifications", "skills"]);
	});
});
