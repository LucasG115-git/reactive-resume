import { beforeAll, describe, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { parseProfileFile } from "./profile-file";
import { PROFILE_FILE_PROMPT, PROFILE_FILE_TEMPLATE } from "./profile-file-prompt";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

describe("profile files", () => {
	it("ships a template that is itself a valid profile file, embedded in the AI prompt", () => {
		const result = parseProfileFile(PROFILE_FILE_TEMPLATE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.file.experience[0]?.achievements).toHaveLength(2);
		expect(result.file.skills.map((skill) => skill.name)).toContain("WordPress");
		expect(PROFILE_FILE_PROMPT).toContain(PROFILE_FILE_TEMPLATE);
	});

	it("reads an assistant's answer in a code fence, and JSON", () => {
		expect(parseProfileFile("```yaml\nskills: [WordPress]\n```").ok).toBe(true);
		expect(parseProfileFile('{"experience":[{"title":"Founder","start":"2019"}]}').ok).toBe(true);
	});

	it("locates problems", () => {
		expect(parseProfileFile("experience:\n  - title: A\n    start: March 2019\n")).toEqual({
			ok: false,
			problems: ['experience[0].start: "March 2019" isn\'t a date. Use YYYY or YYYY-MM, or "present".'],
		});
		const unknown = parseProfileFile("jobs: []");
		expect(unknown.ok).toBe(false);
		expect(!unknown.ok && unknown.problems[0]).toMatch(/unknown key "jobs"/);
		expect(parseProfileFile("- just a list").ok).toBe(false);
		expect(parseProfileFile("key: [unclosed").ok).toBe(false);
	});
});
