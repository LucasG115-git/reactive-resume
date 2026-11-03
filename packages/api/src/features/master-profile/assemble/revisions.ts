import type { ProfileAssemblyResult } from "@reactive-resume/schema/master-profile";
import type { ReviewRevision } from "@reactive-resume/schema/resume-writing";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { resumeService } from "../../resume/service";
import { escapeHtml } from "./build";

export type RevisionAction = "revert" | "apply" | "dismiss";

/** The status a revision may move from for each action. */
const FROM: Record<RevisionAction, ReviewRevision["status"][]> = {
	revert: ["applied"],
	apply: ["needs-review", "reverted"],
	dismiss: ["needs-review"],
};

const TO: Record<RevisionAction, ReviewRevision["status"]> = {
	revert: "reverted",
	apply: "applied",
	dismiss: "dismissed",
};

/**
 * Swaps one line's wording in a resume's rich text, matching the paragraph the assembly wrote. Returns null when
 * the line isn't there as written (the user has edited it since).
 */
export function swapLine(data: ResumeData, from: string, to: string): ResumeData | null {
	const json = JSON.stringify(data);
	const needle = JSON.stringify(`<p>${escapeHtml(from)}</p>`).slice(1, -1);
	const index = json.indexOf(needle);
	if (index < 0) return null;
	const replacement = JSON.stringify(`<p>${escapeHtml(to)}</p>`).slice(1, -1);
	return JSON.parse(json.slice(0, index) + replacement + json.slice(index + needle.length)) as ResumeData;
}

export const revisionService = {
	/**
	 * Puts a reviewer change back to the draft wording, applies one that waited for the user, or dismisses it.
	 * Only the resume's wording changes; the master profile never does.
	 */
	update: async (userId: string, input: { assemblyId: string; index: number; action: RevisionAction }) => {
		const [row] = await db
			.select()
			.from(tables.profileAssembly)
			.where(and(eq(tables.profileAssembly.id, input.assemblyId), eq(tables.profileAssembly.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		const result = structuredClone(row.result) as ProfileAssemblyResult;
		const revision = result.writing?.review?.revisions[input.index];
		if (!revision) throw new ORPCError("NOT_FOUND", { message: "That suggestion no longer exists." });
		if (!FROM[input.action].includes(revision.status))
			throw new ORPCError("BAD_REQUEST", { message: `This suggestion is already ${revision.status}.` });

		if (input.action !== "dismiss") {
			if (!row.resumeId) throw new ORPCError("NOT_FOUND", { message: "The resume was deleted." });
			const resume = await resumeService.getById({ id: row.resumeId, userId });
			const [from, to] =
				input.action === "revert" ? [revision.after, revision.before] : [revision.before, revision.after];
			const data = swapLine(resume.data, from, to);
			if (!data)
				throw new ORPCError("BAD_REQUEST", {
					message: "That line has been edited since. Change it in the editor instead.",
				});
			await resumeService.update({ id: row.resumeId, userId, data });
			const bullet = result.bullets.find((item) => item.achievementId === revision.achievementId);
			if (revision.target === "bullet" && bullet) bullet.text = to;
			if (revision.target === "summary" && result.writing) result.writing.summary = to;
		}
		revision.status = TO[input.action];
		await db.update(tables.profileAssembly).set({ result }).where(eq(tables.profileAssembly.id, row.id));
		return result;
	},
};
