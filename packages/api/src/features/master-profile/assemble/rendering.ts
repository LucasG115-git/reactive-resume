import type { QualityFinding, RenderingReport } from "@reactive-resume/schema/resume-writing";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { strFromU8, unzipSync } from "fflate";
import { analyzePdfResume, buildExtractedDocument } from "@reactive-resume/resume/ats-pdf";

/**
 * Rendering validation: renders the assembled resume to PDF and DOCX the way an export does, reads the text back
 * the way an applicant tracking system would, and checks nothing was lost: every bullet, the name and title are
 * extractable, positions read in order, no page is blank, and the page count matches the target. Nothing in the
 * resume is changed by it.
 */

const normal = (text: string) =>
	` ${text
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[̀-ͯ]/g, "")
		.replace(/ﬁ/g, "fi")
		.replace(/ﬂ/g, "fl")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()} `;

/** The first words of a line: enough to find it, short enough to survive a hyphenated break later in the line. */
const probe = (text: string) => normal(text).trim().split(" ").slice(0, 10).join(" ");

const htmlText = (html: string) =>
	html
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();

/** What must survive export: the name, the headline, and every bullet. */
export function expectedLines(data: ResumeData, bullets: string[]) {
	return [data.basics.name, data.basics.headline, ...bullets].map((line) => htmlText(line)).filter(Boolean);
}

/** Lines whose opening words aren't in the extracted text, and the share found. */
export function coverageOf(text: string, lines: string[]) {
	const haystack = normal(text);
	const missing = lines.filter((line) => {
		const words = probe(line);
		return words.length > 0 && !haystack.includes(` ${words} `);
	});
	return { textCoverage: lines.length ? (lines.length - missing.length) / lines.length : 1, missing };
}

/** True when each position title appears after the one before it. */
export function readsInOrder(text: string, titles: string[]) {
	const haystack = normal(text);
	let from = 0;
	for (const title of titles) {
		const index = haystack.indexOf(` ${probe(title)} `, from);
		if (index < 0) return false;
		from = index + 1;
	}
	return true;
}

/** The text of a DOCX file's body, one paragraph per line. */
export function docxText(bytes: Uint8Array) {
	const files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" });
	const xml = files["word/document.xml"];
	if (!xml) throw new Error("The DOCX has no document body.");
	return strFromU8(xml)
		.split(/<\/w:p>/)
		.map((paragraph) => [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(""))
		.join("\n")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

type Renderers = {
	/** PDF bytes for the resume. */
	pdf: (data: ResumeData) => Promise<Uint8Array>;
	/** DOCX bytes for the resume. */
	docx: (data: ResumeData) => Promise<Uint8Array>;
};

/** The renderers exports use. Loaded lazily: PDF rendering pulls in fonts and WASM. */
export const exportRenderers: Renderers = {
	pdf: async (data) => {
		const { createResumePdfFile } = await import("@reactive-resume/pdf/server");
		const file = await createResumePdfFile({ data, filename: "resume.pdf" });
		return new Uint8Array(await file.arrayBuffer());
	},
	docx: async (data) => {
		const { buildDocx } = await import("@reactive-resume/docx");
		return new Uint8Array(await (await buildDocx(data)).arrayBuffer());
	},
};

async function readPdf(bytes: Uint8Array) {
	const { extractPdf } = await import("../../resume/pdf-analysis");
	return extractPdf(new File([bytes as Uint8Array<ArrayBuffer>], "resume.pdf", { type: "application/pdf" }));
}

export async function validateRendering(input: {
	data: ResumeData;
	bullets: string[];
	targetPages: number;
	renderers?: Renderers;
	now?: Date;
}): Promise<{ report: RenderingReport; findings: QualityFinding[] }> {
	const renderers = input.renderers ?? exportRenderers;
	const lines = expectedLines(input.data, input.bullets);
	const titles = input.data.sections.experience.hidden
		? []
		: input.data.sections.experience.items.filter((item) => !item.hidden).map((item) => item.position);
	const report: RenderingReport = { pdf: null, docx: null, errors: [] };
	const findings: QualityFinding[] = [];

	try {
		const raw = await readPdf(await renderers.pdf(input.data));
		const extracted = buildExtractedDocument(raw);
		const coverage = coverageOf(extracted.fullText, lines);
		const blankPages = raw.pages
			.filter((page) => !page.items.some((item) => item.str.trim()))
			.map((page) => page.pageNumber);
		const ats = analyzePdfResume(raw, input.now ? { now: input.now } : {});
		const last = raw.pages.at(-1);
		const lowest = last?.items.filter((item) => item.str.trim()).map((item) => item.transform[5] ?? 0) ?? [];
		const lastPageFill =
			last && lowest.length > 0 ? Math.round(((last.height - Math.min(...lowest)) / last.height) * 100) / 100 : 0;
		report.pdf = {
			pages: raw.pageCount,
			blankPages,
			...coverage,
			readingOrder: readsInOrder(extracted.fullText, titles),
			atsScore: ats.score,
			lastPageFill,
		};
		if (blankPages.length > 0)
			findings.push({
				code: "render-blank-page",
				severity: "error",
				message: `The PDF has a blank page (page ${blankPages.join(", ")}). Check the layout or page breaks.`,
			});
		if (coverage.missing.length > 0)
			findings.push({
				code: "render-text-missing",
				severity: coverage.textCoverage < 0.9 ? "error" : "warning",
				message: `${coverage.missing.length} line${coverage.missing.length === 1 ? "" : "s"} couldn't be read from the PDF, so an applicant tracking system may miss ${coverage.missing.length === 1 ? "it" : "them"}: "${coverage.missing[0]?.slice(0, 80)}".`,
			});
		if (!report.pdf.readingOrder)
			findings.push({
				code: "render-reading-order",
				severity: "warning",
				message: "Positions don't read back in order from the PDF. A single-column template reads more reliably.",
			});
		if (raw.pageCount > input.targetPages)
			findings.push({
				code: "render-pages",
				severity: "warning",
				message: `The PDF is ${raw.pageCount} pages; the target is ${input.targetPages}.`,
			});
		// A mostly empty last page looks like the resume ran over; trim to fewer pages or use the space.
		if (raw.pageCount > 1 && lastPageFill < 0.35)
			findings.push({
				code: "render-sparse-page",
				severity: "warning",
				message: `Page ${raw.pageCount} is only about ${Math.max(5, Math.round(lastPageFill * 100))}% full. Trim the weakest bullets to fit ${raw.pageCount - 1} page${raw.pageCount === 2 ? "" : "s"}, or add relevant content.`,
			});
		const blockers = ats.checks.filter((check) => check.status === "fail" && check.severity === "blocker");
		if (blockers.length > 0)
			findings.push({
				code: "render-ats",
				severity: "warning",
				message: `The ATS check found problems reading the PDF: ${blockers.map((check) => check.code).join(", ")}. Open Check → ATS for details.`,
			});
	} catch (error) {
		report.errors.push(`PDF: ${error instanceof Error ? error.message.slice(0, 200) : "couldn't be rendered"}`);
	}

	try {
		const text = docxText(await renderers.docx(input.data));
		report.docx = coverageOf(text, lines);
		if (report.docx.missing.length > 0)
			findings.push({
				code: "docx-text-missing",
				severity: "warning",
				message: `${report.docx.missing.length} line${report.docx.missing.length === 1 ? "" : "s"} missing from the Word file: "${report.docx.missing[0]?.slice(0, 80)}".`,
			});
	} catch (error) {
		report.errors.push(`DOCX: ${error instanceof Error ? error.message.slice(0, 200) : "couldn't be built"}`);
	}

	if (report.errors.length > 0)
		findings.push({
			code: "render-failed",
			severity: "info",
			message: `The exported files couldn't all be checked (${report.errors.join("; ")}). Export them and look them over.`,
		});
	return { report, findings };
}
