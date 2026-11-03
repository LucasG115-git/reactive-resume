import { describe, expect, it } from "vite-plus/test";
import { zipSync, strToU8 } from "fflate";
import { DEFAULT_WRITING_RULES } from "@reactive-resume/schema/resume-writing";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { communicationsJob, consultantProfile } from "../selection/fixtures";
import { buildSelection } from "../selection/service";
import { tokens } from "../selection/text";
import { writeFromPlan } from "../writing/service";
import { buildResume } from "./build";
import { coverageOf, docxText, readsInOrder, validateRendering } from "./rendering";

const now = new Date("2026-11-01T00:00:00Z");

const resume = () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Avery Example";
	data.basics.headline = "Nonprofit Web Consultant";
	data.basics.email = "avery@example.test";
	return data;
};

/** A resume assembled from the fixture profile for a communications posting, in the user's own words. */
async function assembled() {
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
	});
	const written = await writeFromPlan({
		userId: "u",
		plan,
		analysis,
		profile,
		rules: DEFAULT_WRITING_RULES,
		mode: "verbatim",
		ask: async () => {
			throw new Error("verbatim needs no AI");
		},
	});
	const base = resume();
	base.basics.phone = "555-0100";
	base.basics.location = "Peterborough, ON";
	return buildResume({
		base,
		profile,
		plan,
		mode: "verbatim",
		now,
		selection: {
			achievements: [...written.bullets].map(([id, bullet]) => ({ id, text: bullet.text })),
			skills: written.skills.map((item) => item.id),
			summary: "",
		},
		writing: { headline: "Nonprofit Communications and Web Consultant", skillGroups: written.skillGroups },
	});
}

describe("reading text back", () => {
	it("finds lines across wrapping, case and punctuation", () => {
		const text =
			"AVERY EXAMPLE\nRebuilt a WordPress volunteer portal for a regional\nvolunteer centre, cutting admin time by 40%";
		expect(
			coverageOf(text, [
				"Avery Example",
				"Rebuilt a WordPress volunteer portal for a regional volunteer centre, cutting coordinator admin time",
				"Wrote press releases",
			]),
		).toEqual({ textCoverage: 2 / 3, missing: ["Wrote press releases"] });
	});

	it("checks positions read in the order written", () => {
		const text = "Founder & Principal Northbrook ... Communications Coordinator Riverside";
		expect(readsInOrder(text, ["Founder & Principal", "Communications Coordinator"])).toBe(true);
		expect(readsInOrder(text, ["Communications Coordinator", "Founder & Principal"])).toBe(false);
	});

	it("reads a Word file's paragraphs", () => {
		const xml =
			'<w:document><w:body><w:p><w:r><w:t>Avery</w:t></w:r><w:r><w:t xml:space="preserve"> Example</w:t></w:r></w:p><w:p><w:r><w:t>R&amp;D lead</w:t></w:r></w:p></w:body></w:document>';
		expect(docxText(zipSync({ "word/document.xml": strToU8(xml) }))).toBe("Avery Example\nR&D lead\n");
	});
});

describe("validateRendering", () => {
	it("renders the real PDF and DOCX of an assembled resume and finds every line", async () => {
		const built = await assembled();
		const { report, findings } = await validateRendering({
			data: built.data,
			bullets: built.bullets.map((bullet) => bullet.text),
			targetPages: 2,
			now,
		});
		expect(report.errors).toEqual([]);
		expect(report.pdf).toMatchObject({ blankPages: [], textCoverage: 1, missing: [], readingOrder: true });
		expect(report.pdf?.pages).toBeLessThanOrEqual(2);
		expect(report.pdf?.atsScore).toBeGreaterThan(70);
		expect(report.docx).toEqual({ textCoverage: 1, missing: [] });
		expect(findings).toEqual([]);
	}, 60_000);

	it("reports lost text, extra pages and files it couldn't check", async () => {
		const { report, findings } = await validateRendering({
			data: resume(),
			bullets: ["A bullet the renderer dropped"],
			targetPages: 1,
			renderers: {
				pdf: async () => {
					throw new Error("no fonts");
				},
				docx: async () =>
					zipSync({
						"word/document.xml": strToU8(
							"<w:p><w:t>Avery Example</w:t></w:p><w:p><w:t>Nonprofit Web Consultant</w:t></w:p>",
						),
					}),
			},
		});
		expect(report.pdf).toBeNull();
		expect(report.docx?.missing).toEqual(["A bullet the renderer dropped"]);
		expect(findings.map((finding) => finding.code)).toEqual(["docx-text-missing", "render-failed"]);
	});
});
