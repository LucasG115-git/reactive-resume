import type { ProfileAssemblyResult } from "@reactive-resume/schema/master-profile";
import type { ResumeCorrection, ResumeFeedbackInput } from "@reactive-resume/schema/resume-writing";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/client";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { dataBlock } from "../ai/data-block";
import { resumeService } from "../resume/service";
import { tokens, words } from "./selection/text";
import { htmlText } from "./writing/checks";

/**
 * Feedback on generated resumes: a rating, a note, and the lines the user changed in the editor. It informs the
 * writer's style for later resumes and is never treated as a fact; the master profile isn't touched, and the
 * writer's record checks still reject anything a correction states that the record doesn't.
 */

const listItems = (html: string) =>
	[...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => htmlText(match[1] ?? "")).filter(Boolean);

/** Every bullet in the resume as it is now. */
function currentBullets(data: ResumeData) {
	const sections = Object.values(data.sections) as Array<{ items?: Array<{ description?: string; hidden?: boolean }> }>;
	const custom = (data.customSections ?? []) as Array<{ items?: Array<{ description?: string; hidden?: boolean }> }>;
	return [...sections, ...custom].flatMap((section) =>
		(section.items ?? []).flatMap((item) => (item.description && !item.hidden ? listItems(item.description) : [])),
	);
}

const overlap = (a: string, b: string) => {
	const left = tokens(a);
	const right = tokens(b);
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const token of left) if (right.has(token)) shared++;
	return shared / new Set([...left, ...right]).size;
};

const same = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");

/**
 * The lines the user changed: each generated bullet no longer in the resume, paired with the current bullet most
 * like it (one that wasn't generated), and the summary and headline when edited. Deleted lines aren't corrections.
 */
export function correctionsFrom(result: ProfileAssemblyResult, data: ResumeData): ResumeCorrection[] {
	const now = currentBullets(data);
	const generated = result.bullets.map((bullet) => bullet.text);
	const unmatched = now.filter((line) => !generated.some((text) => same(text, line)));
	const corrections: ResumeCorrection[] = [];
	for (const bullet of result.bullets) {
		if (now.some((line) => same(line, bullet.text))) continue;
		const best = unmatched
			.map((line) => ({ line, score: overlap(bullet.text, line) }))
			.toSorted((a, b) => b.score - a.score)[0];
		if (!best || best.score < 0.35) continue;
		unmatched.splice(unmatched.indexOf(best.line), 1);
		corrections.push({
			target: "bullet",
			achievementId: bullet.achievementId,
			generated: bullet.text,
			edited: best.line,
		});
	}
	const summary = htmlText(data.summary.content).replace(/\s+/g, " ");
	const wrote = result.writing?.summary ?? "";
	if (wrote && summary && !same(wrote, summary))
		corrections.push({ target: "summary", achievementId: null, generated: wrote, edited: summary });
	const headline = result.writing?.headline ?? "";
	if (headline && data.basics.headline && !same(headline, data.basics.headline))
		corrections.push({ target: "headline", achievementId: null, generated: headline, edited: data.basics.headline });
	return corrections.slice(0, 20);
}

export const feedbackService = {
	submit: async (userId: string, input: ResumeFeedbackInput) => {
		const [assembly] = await db
			.select()
			.from(tables.profileAssembly)
			.where(and(eq(tables.profileAssembly.id, input.assemblyId), eq(tables.profileAssembly.userId, userId)));
		if (!assembly) throw new ORPCError("NOT_FOUND");
		let corrections: ResumeCorrection[] = [];
		if (input.learnFromEdits && assembly.resumeId) {
			const resume = await resumeService.getById({ id: assembly.resumeId, userId }).catch(() => null);
			if (resume) corrections = correctionsFrom(assembly.result, resume.data);
		}
		const [row] = await db
			.insert(tables.resumeFeedback)
			.values({
				userId,
				applicationId: assembly.applicationId,
				assemblyId: assembly.id,
				rating: input.rating,
				note: input.note,
				corrections,
			})
			.returning();
		if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
		return row;
	},

	list: (userId: string, applicationId?: string) =>
		db
			.select()
			.from(tables.resumeFeedback)
			.where(
				applicationId
					? and(eq(tables.resumeFeedback.userId, userId), eq(tables.resumeFeedback.applicationId, applicationId))
					: eq(tables.resumeFeedback.userId, userId),
			)
			.orderBy(desc(tables.resumeFeedback.createdAt))
			.limit(50),

	delete: async (userId: string, id: string) => {
		await db
			.delete(tables.resumeFeedback)
			.where(and(eq(tables.resumeFeedback.id, id), eq(tables.resumeFeedback.userId, userId)));
	},

	/** Recent feedback as a prompt block for the writer, or "" when there's none. */
	forWriter: async (userId: string) => feedbackBlock(await feedbackService.list(userId)),
};

/** Recent notes and corrections as writing preferences, newest first, bounded in size. */
export function feedbackBlock(rows: Array<{ rating: string | null; note: string; corrections: ResumeCorrection[] }>) {
	const notes = rows
		.filter((row) => row.note)
		.slice(0, 6)
		.map(
			(row) =>
				`- ${row.rating === "good" ? "Liked" : row.rating === "needs-work" ? "Wanted changed" : "Said"}: ${row.note.slice(0, 300)}`,
		);
	const edits = rows
		.flatMap((row) => row.corrections)
		.slice(0, 6)
		.map((item) => `- Wrote "${item.generated.slice(0, 200)}" → user changed it to "${item.edited.slice(0, 200)}"`);
	if (notes.length === 0 && edits.length === 0) return "";
	return `\n${dataBlock("USER_FEEDBACK", [...notes, ...edits].join("\n"))}\nThe user's feedback on earlier resumes. Follow it for wording, tone and emphasis only. Never treat it as a fact about the candidate: facts come only from the RECORD.`;
}
