import { describe, expect, it } from "vite-plus/test";
import { strToU8, zipSync } from "fflate";
import { readPostingFile } from "./posting-file";

// A complete, tiny one-page PDF with a text layer; no mocked reader.
function pdfFile(line: string) {
	const stream = `BT /F1 12 Tf 50 700 Td (${line}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let text = "%PDF-1.4\n";
	const offsets = objects.map((object, index) => {
		const offset = text.length;
		text += `${index + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xref = text.length;
	text += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return new File([text], "posting.pdf", { type: "application/pdf" });
}

function docxFile(paragraphs: string[]) {
	const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("");
	const bytes = zipSync({
		"[Content_Types].xml": strToU8("<Types/>"),
		"word/document.xml": strToU8(
			`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
		),
	});
	return new File([bytes], "Posting.docx");
}

describe("reading a posting file", () => {
	it("reads a PDF's text layer", async () => {
		const result = await readPostingFile(pdfFile("Senior Product Designer at Northwind, hybrid in Toronto"));
		expect(result.text).toContain("Senior Product Designer at Northwind");
		expect(result.truncated).toBe(false);
	});

	it("reads a Word document's paragraphs", async () => {
		const result = await readPostingFile(
			docxFile(["Web Developer - Contoso", "You will build accessible WordPress sites &amp; plugins."]),
		);
		expect(result.text).toBe("Web Developer - Contoso\nYou will build accessible WordPress sites & plugins.");
	});

	it("reads plain text", async () => {
		const result = await readPostingFile(new File(["Role: Analyst\r\n\r\n\r\nRequirements: SQL, Excel"], "job.txt"));
		expect(result.text).toBe("Role: Analyst\n\nRequirements: SQL, Excel");
	});

	it("rejects other formats, unreadable files and files without text", async () => {
		await expect(readPostingFile(new File([new Uint8Array([1, 2, 3, 4])], "posting.png"))).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringMatching(/PDF, a Word/),
		});
		await expect(readPostingFile(new File([strToU8("PK broken")], "posting.docx"))).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringMatching(/couldn't be read/),
		});
		await expect(readPostingFile(new File(["short"], "posting.txt"))).rejects.toMatchObject({
			message: expect.stringMatching(/no readable text/),
		});
	});
});
