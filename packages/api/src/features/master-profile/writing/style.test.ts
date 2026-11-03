import type { StyleExample } from "@reactive-resume/schema/resume-style";
import { describe, expect, it } from "vite-plus/test";
import {
	choosePreset,
	DEFAULT_STYLE_GUIDE,
	presetFromTemplate,
	resumeStyleGuideSchema,
	rulesFor,
} from "@reactive-resume/schema/resume-style";
import { communicationsJob, consultantProfile } from "../selection/fixtures";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { chooseSkills } from "./skills";
import { acceptWriting, copiedPhrase, writerPrompt } from "./write";

const now = new Date("2026-11-01T00:00:00Z");
const guide = resumeStyleGuideSchema.parse({
	defaultPresetId: "general",
	presets: [
		presetFromTemplate("general", "general"),
		presetFromTemplate("communications", "comms"),
		presetFromTemplate("web-development", "web"),
	],
	examples: [],
});

describe("style presets", () => {
	it("picks the preset matching the posting's title, the user's choice, or the default", () => {
		expect(choosePreset(guide, "Communications Manager").id).toBe("comms");
		expect(choosePreset(guide, "Senior Front-end Developer").id).toBe("web");
		expect(choosePreset(guide, "Bookkeeper").id).toBe("general");
		expect(
			choosePreset(
				{ ...guide, presets: [...guide.presets, presetFromTemplate("project-management", "pm")] },
				"Digital Projects Manager",
			).id,
		).toBe("pm");
		expect(choosePreset(guide, "Communications Manager", "web").id).toBe("web");
		expect(choosePreset(DEFAULT_STYLE_GUIDE, "Anything").name).toBe("General");
	});

	it("derives bullet length from density and rejects a guide without its default preset", () => {
		const dense = { ...presetFromTemplate("web-development", "w") };
		const light = { ...dense, density: "light" as const };
		expect(rulesFor(dense).bullets.maxWords).toBe(40);
		expect(rulesFor(light).bullets.maxWords).toBe(30);
		expect(resumeStyleGuideSchema.safeParse({ ...guide, defaultPresetId: "missing" }).success).toBe(false);
	});
});

describe("writing with a style", () => {
	const example: StyleExample = {
		id: "ex",
		title: "Jordan's resume",
		source: "upload",
		resumeId: null,
		text: "Grew volunteer retention across three regional chapters by redesigning onboarding for new members. Built partnerships with local media outlets.",
		notes: "short, confident bullets",
		addedAt: now.toISOString(),
	};

	it("tells the writer the tone, bullet style, older-role treatment, group names and examples, as style only", async () => {
		const profile = consultantProfile();
		const { plan } = await buildSelection({
			applicationId: "app",
			analysis: communicationsJob(),
			profile,
			blocked: new Map(),
			emphasis: { text: "", tokens: tokens("") },
			previous: null,
			now,
			review: async () => null,
		});
		const comms = guide.presets[1];
		if (!comms) throw new Error("No preset.");
		const style = { preset: { ...comms, notes: "No first person." }, examples: [example] };
		const { prompt } = writerPrompt({
			plan,
			analysis: communicationsJob(),
			profile,
			skills: chooseSkills(profile, plan, rulesFor(comms)).skills,
			rules: rulesFor(comms),
			style,
			now,
		});
		expect(prompt).toContain("Tone: approachable and people-centred");
		expect(prompt).toContain("No first person.");
		expect(prompt).toContain("Communications & Marketing, Digital Platforms, Project Delivery");
		expect(prompt).toContain("<<<STYLE_EXAMPLES_START>>>");
		expect(prompt).toContain("liked for: short, confident bullets");
		expect(prompt).toMatch(/never copy their content/);
	});

	it("rejects wording borrowed from an example", async () => {
		expect(
			copiedPhrase(
				"Grew volunteer retention across three regional chapters by redesigning onboarding",
				[example.text],
				["Planned a donor campaign"],
			),
		).toBe("grew volunteer retention across three regional");
		expect(
			copiedPhrase(
				"Planned and ran a donor email campaign for a food bank",
				[example.text],
				["Planned and ran a donor email campaign for a food bank"],
			),
		).toBeNull();
		const profile = consultantProfile();
		const { plan } = await buildSelection({
			applicationId: "app",
			analysis: communicationsJob(),
			profile,
			blocked: new Map(),
			emphasis: { text: "", tokens: tokens("") },
			previous: null,
			now,
			review: async () => null,
		});
		const rules = rulesFor(presetFromTemplate("communications", "c"));
		const skills = chooseSkills(profile, plan, rules).skills;
		const { keys } = writerPrompt({ plan, analysis: communicationsJob(), profile, skills, rules });
		const key = [...keys.achievements].find(([, id]) => id === "a-social")?.[0] ?? "";
		const written = acceptWriting({
			output: {
				headline: "",
				summary: "",
				skillGroups: [],
				bullets: [
					{ id: key, text: "Built partnerships with local media outlets, growing social media following by 150%" },
				],
			},
			keys,
			plan,
			profile,
			skills,
			skillsLeftOut: [],
			rules,
			examples: [example.text],
		});
		expect(written.bullets.get("a-social")?.source).toBe("original");
		expect(written.warnings.join("\n")).toMatch(/borrowed .* from a style example/);
	});
});
