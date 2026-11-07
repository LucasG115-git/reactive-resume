import { describe, expect, it } from "vite-plus/test";
import { consultantProfile, communicationsJob, skill } from "../selection/fixtures";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { evidencedSkills, isTechnical } from "./skills";
import { separateTools } from "./write";

const now = new Date("2026-11-01T00:00:00Z");

describe("tools and platforms", () => {
	it("count as technical and get their own group", () => {
		const tools = [
			skill("t1", "Slate CRM", "", [], { kind: "tool" }),
			skill("s1", "Copywriting", "Writing"),
			skill("t2", "WordPress", "", [], { kind: "tool" }),
		];
		expect(isTechnical(tools[0] ?? skill("x", "x", ""))).toBe(true);
		expect(
			separateTools(
				[
					{ name: "Writing", skillIds: ["s1", "t1"] },
					{ name: "Web", skillIds: ["t2"] },
				],
				tools,
			),
		).toEqual([
			{ name: "Writing", skillIds: ["s1"] },
			{ name: "Web", skillIds: ["t2", "t1"] },
		]);
		expect(separateTools([{ name: "Everything", skillIds: ["s1", "t1", "t2"] }], tools)).toEqual([
			{ name: "Everything", skillIds: ["s1"] },
			{ name: "Tools & Platforms", skillIds: ["t1", "t2"] },
		]);
	});

	it("are evidenced by being used at an included role, as well as by bullets naming them", async () => {
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
		const included = plan.entries.find((entry) => entry.include);
		profile.skills.push(skill("used", "Asana", "", [], { kind: "tool", entryIds: [included?.entryId ?? ""] }));
		profile.skills.push(skill("unused", "Jira", "", [], { kind: "tool", entryIds: ["elsewhere"] }));
		const evidenced = evidencedSkills(profile, plan);
		expect(evidenced.has("used")).toBe(true);
		expect(evidenced.has("unused")).toBe(false);
	});
});
