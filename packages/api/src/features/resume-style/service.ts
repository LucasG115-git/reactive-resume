import type { ResumeStyleGuide, StyleExample } from "@reactive-resume/schema/resume-style";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { DEFAULT_STYLE_GUIDE, resumeStyleGuideSchema } from "@reactive-resume/schema/resume-style";
import { generateId } from "@reactive-resume/utils/string";
import { readPostingFile } from "../applications/posting-file";
import { resumeService } from "../resume/service";

const MAX_EXAMPLE_CHARS = 15_000;

/** Stored guides are read leniently: one that no longer parses falls back to the default, rather than failing. */
const parse = (data: unknown): ResumeStyleGuide => {
	const parsed = resumeStyleGuideSchema.safeParse(data);
	return parsed.success ? parsed.data : structuredClone(DEFAULT_STYLE_GUIDE);
};

async function write(userId: string, guide: ResumeStyleGuide) {
	await db
		.insert(tables.resumeStyleGuide)
		.values({ userId, data: guide })
		.onConflictDoUpdate({ target: tables.resumeStyleGuide.userId, set: { data: guide, updatedAt: new Date() } });
	return guide;
}

async function addExample(userId: string, example: Omit<StyleExample, "id" | "addedAt">) {
	const guide = await resumeStyleService.get(userId);
	if (guide.examples.length >= 6)
		throw new ORPCError("BAD_REQUEST", { message: "You can keep up to 6 examples. Remove one to add another." });
	const added: StyleExample = {
		...example,
		text: example.text.slice(0, MAX_EXAMPLE_CHARS),
		id: generateId(),
		addedAt: new Date().toISOString(),
	};
	await write(userId, { ...guide, examples: [...guide.examples, added] });
	return added;
}

export const resumeStyleService = {
	get: async (userId: string): Promise<ResumeStyleGuide> => {
		const [row] = await db
			.select({ data: tables.resumeStyleGuide.data })
			.from(tables.resumeStyleGuide)
			.where(eq(tables.resumeStyleGuide.userId, userId));
		return row ? parse(row.data) : structuredClone(DEFAULT_STYLE_GUIDE);
	},

	/** Saves presets and settings. Example texts are kept from the stored guide; only their titles and notes change here. */
	save: async (userId: string, input: ResumeStyleGuide) => {
		const stored = await resumeStyleService.get(userId);
		const texts = new Map(stored.examples.map((example) => [example.id, example]));
		const examples = input.examples.flatMap((example) => {
			const kept = texts.get(example.id);
			return kept ? [{ ...kept, title: example.title, notes: example.notes }] : [];
		});
		const ids = new Set(examples.map((example) => example.id));
		const presets = input.presets.map((preset) => ({
			...preset,
			exampleIds: preset.exampleIds.filter((exampleId) => ids.has(exampleId)),
		}));
		return write(userId, resumeStyleGuideSchema.parse({ ...input, presets, examples }));
	},

	/** An example from one of the user's resumes, as text at the time it's added. */
	addExampleFromResume: async (
		userId: string,
		input: { resumeId: string; title?: string | undefined; notes?: string | undefined },
	) => {
		const resume = await resumeService.getById({ id: input.resumeId, userId });
		const text = buildMarkdown(resume.data).trim();
		if (text.length < 100)
			throw new ORPCError("BAD_REQUEST", { message: "That resume has too little text to learn a style from." });
		return addExample(userId, {
			title: input.title?.trim() || resume.name,
			source: "resume",
			resumeId: resume.id,
			text,
			notes: input.notes?.trim() ?? "",
		});
	},

	/** An example uploaded as a PDF, Word or text file. Only its text is kept. */
	addExampleFromFile: async (
		userId: string,
		input: { file: File; notes?: string | undefined },
		signal?: AbortSignal,
	) => {
		const { text } = await readPostingFile(input.file, signal);
		if (text.length < 100)
			throw new ORPCError("BAD_REQUEST", { message: "That file has too little text to learn a style from." });
		const title = input.file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Uploaded example";
		return addExample(userId, { title, source: "upload", resumeId: null, text, notes: input.notes?.trim() ?? "" });
	},
};
