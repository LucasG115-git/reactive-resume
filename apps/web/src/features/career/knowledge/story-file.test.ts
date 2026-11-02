import { beforeAll, describe, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { parseStoryFile } from "./story-file";
import { buildStoryPrompt, STORY_FILE_TEMPLATE } from "./story-file-prompt";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

describe("story files", () => {
	it("ships a valid template, embedded in a prompt that lists the user's facts", () => {
		const result = parseStoryFile(STORY_FILE_TEMPLATE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.file.stories[0]).toMatchObject({
			title: "Automating chapter membership checks",
			facts: ["F-1a2b3c4d", "F-5e6f7a8b"],
		});
		const prompt = buildStoryPrompt([{ ref: "F-0011aabb", category: "accomplishment", text: "Built a sync" }]);
		expect(prompt).toContain("F-0011aabb [accomplishment] Built a sync");
		expect(prompt).toContain(STORY_FILE_TEMPLATE);
	});

	it("locates problems", () => {
		expect(parseStoryFile("stories:\n  - title: A\n    situation: S\n    action: A\n")).toEqual({
			ok: false,
			problems: ["stories[0].task: Task is required"],
		});
		const unknown = parseStoryFile("story: []");
		expect(!unknown.ok && unknown.problems.join(" / ")).toMatch(/unknown key "story". Use version and stories./);
	});
});
