import { ORPCError } from "@orpc/server";

export const POSTING_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type PostingFileText = { text: string; truncated: boolean };

const hasPdfMagic = (bytes: Uint8Array) => [0x25, 0x50, 0x44, 0x46].every((byte, index) => bytes[index] === byte);
const hasZipMagic = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

/**
 * The text of a job posting saved as a PDF, Word (.docx) or plain-text file. PDFs are read from their text layer
 * (no OCR); .docx from its body text. The type comes from the file's bytes, then its name.
 */
export async function readPostingFile(file: File, signal?: AbortSignal): Promise<PostingFileText> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const name = file.name.toLowerCase();
	let result: PostingFileText;
	try {
		if (hasPdfMagic(bytes)) {
			const [{ extractPdf }, { documentToLines }, { buildExtractedDocument }] = await Promise.all([
				import("../resume/pdf-analysis"),
				import("@reactive-resume/import/pdf-lines"),
				import("@reactive-resume/resume/ats-pdf"),
			]);
			const raw = await extractPdf(file, signal, 0);
			result = { text: documentToLines(buildExtractedDocument(raw)).join("\n"), truncated: raw.truncated };
		} else if (hasZipMagic(bytes) && !name.endsWith(".doc")) {
			const { docxText } = await import("../ai/service");
			result = { text: docxText(bytes), truncated: false };
		} else if (/\.(txt|md|markdown|text)$/.test(name) || file.type.startsWith("text/")) {
			result = { text: new TextDecoder().decode(bytes), truncated: false };
		} else {
			throw new ORPCError("BAD_REQUEST", {
				message: "Upload the posting as a PDF, a Word (.docx) file or a text file.",
			});
		}
	} catch (error) {
		signal?.throwIfAborted();
		if (error instanceof ORPCError) throw error;
		throw new ORPCError("BAD_REQUEST", {
			message: "That file couldn't be read. Use a PDF with selectable text, a .docx file, or paste the posting.",
			cause: error,
		});
	}
	const text = result.text
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (text.length < 20)
		throw new ORPCError("BAD_REQUEST", {
			message: "That file has no readable text. If it's a scanned PDF, paste the posting instead.",
		});
	return { text, truncated: result.truncated };
}
