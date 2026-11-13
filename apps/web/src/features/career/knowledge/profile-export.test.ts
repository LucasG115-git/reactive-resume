import type { RouterOutput } from "@/libs/orpc/client";
import { describe, expect, it } from "vite-plus/test";
import { profileFileSchema } from "@reactive-resume/schema/master-profile";
import { buildProfileFile } from "./profile-export";

type MasterProfile = RouterOutput["masterProfile"]["get"];

// buildProfileFile only reads a subset of fields, so the fixture carries just those and is cast to the full type.
const profile = {
	entries: [
		{
			id: "e1",
			kind: "position",
			title: "Senior Engineer",
			organization: "Acme",
			location: "Remote",
			url: "",
			startDate: "2020-01",
			endDate: null,
			summary: "Led the web platform team.",
			tags: ["leadership"],
			hidden: false,
			achievements: [
				{
					id: "a1",
					entryId: "e1",
					text: "Cut build times by 40%",
					metrics: [{ value: "40", unit: "%", label: "faster builds" }],
					skills: ["TypeScript"],
					tags: ["performance"],
					variants: ["Reduced CI build time 40%"],
					core: true,
					hidden: false,
				},
			],
		},
		{
			id: "e2",
			kind: "project",
			title: "Side Project",
			organization: "",
			location: "",
			url: "https://example.com",
			startDate: "2019",
			endDate: "2019",
			summary: "",
			tags: [],
			hidden: true,
			achievements: [],
		},
	],
	standalone: [
		{
			id: "a2",
			entryId: null,
			text: "Spoke at a conference",
			metrics: [],
			skills: [],
			tags: [],
			variants: [],
			core: false,
			hidden: false,
		},
	],
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
			hidden: true,
		},
	],
} as unknown as MasterProfile;

describe("buildProfileFile", () => {
	it("produces a file that re-parses through the import schema", () => {
		const file = buildProfileFile(profile);
		expect(() => profileFileSchema.parse(file)).not.toThrow();
	});

	it("groups entries by kind and keeps standalone achievements", () => {
		const parsed = profileFileSchema.parse(buildProfileFile(profile));
		// The position entry plus the "Other achievements" carrier for the standalone achievement.
		expect(parsed.experience).toHaveLength(2);
		expect(parsed.experience.map((entry) => entry.title)).toContain("Other achievements");
		expect(parsed.experience.flatMap((entry) => entry.achievements.map((item) => item.text))).toContain(
			"Spoke at a conference",
		);
		expect(parsed.projects).toHaveLength(1);
		expect(parsed.education).toHaveLength(0);
	});

	it("keeps skill levels and other fields", () => {
		const parsed = profileFileSchema.parse(buildProfileFile(profile));
		const ts = parsed.skills.find((skill) => skill.name === "TypeScript");
		expect(ts).toMatchObject({ level: 4, years: 5, category: "Web", aliases: ["TS"] });
		// Parsed skills are a union (string-or-object), so narrow before reading an object-only field.
		const figma = parsed.skills.find((skill) => skill.name === "Figma") as Record<string, unknown> | undefined;
		expect(figma?.hidden).toBe(true);
	});

	it("keeps achievement metrics, variants and core", () => {
		const parsed = profileFileSchema.parse(buildProfileFile(profile));
		// Parsed achievements are a union (string-or-object); cast to read object-only fields in the test.
		const achievement = parsed.experience[0]?.achievements[0] as Record<string, unknown> | undefined;
		expect(achievement?.text).toBe("Cut build times by 40%");
		expect((achievement?.metrics as { value: string; unit: string }[] | undefined)?.[0]).toMatchObject({
			value: "40",
			unit: "%",
		});
		expect(achievement?.core).toBe(true);
	});
});
