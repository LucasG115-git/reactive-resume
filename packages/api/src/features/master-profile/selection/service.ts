import type { MasterProfile } from "../service";
import type { AskModel } from "./model";
import type { Blocked } from "./rank";
import type { Review } from "./review";
import type { AiTask, TokenUsage } from "@reactive-resume/schema/ai-tasks";
import type { JobAnalysis, ResumeSelectionPlan, SelectionEdit } from "@reactive-resume/schema/resume-selection";
import { ORPCError } from "@orpc/client";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { careerProfileDataSchema } from "@reactive-resume/schema/career";
import { applicationService } from "../../applications/service";
import { masterProfileService } from "../service";
import { analysisOutputSchema, analysisPrompt, ANALYSIS_SYSTEM, normalizeAnalysis, postingHash } from "./analysis";
import { applyEdit, composePlan, finalize } from "./compose";
import { askDefaultModel } from "./model";
import { eligibleProfile, rankEvidence, requirementTerms, shortlist } from "./rank";
import { EMPTY_REVIEW, resolveReview, REVIEW_SYSTEM, reviewOutputSchema, reviewPrompt } from "./review";
import { tokens } from "./text";

/** One model call's usage, for the record kept with plans and assemblies. */
export const usageOf = (
	step: string,
	task: AiTask,
	answer: {
		model: string;
		usage?: { inputTokens: number; outputTokens: number } | undefined;
		fallback?: boolean | undefined;
	},
): TokenUsage => ({
	step,
	task,
	model: answer.model,
	inputTokens: answer.usage?.inputTokens ?? 0,
	outputTokens: answer.usage?.outputTokens ?? 0,
	fallback: answer.fallback ?? false,
});

type Options = { ask?: AskModel; signal?: AbortSignal | undefined; now?: Date };

/**
 * Records kept out of tailoring through Career Knowledge: a profile fact switched off or forgotten, or made
 * private to a different application, keeps its achievement or entry out of this application's selection.
 */
async function blockedRecords(userId: string, applicationId: string): Promise<Blocked> {
	const rows = await db
		.select({
			source: tables.careerFact.source,
			status: tables.careerFact.status,
			applicationId: tables.careerFact.applicationId,
		})
		.from(tables.careerFact)
		.where(and(eq(tables.careerFact.userId, userId), sql`${tables.careerFact.source}->>'kind' = 'profile'`));
	const blocked: Blocked = new Map();
	for (const row of rows) {
		const [, id] = String(row.source.id ?? "").split(":");
		if (!id) continue;
		if (row.status !== "active") blocked.set(id, "Switched off in Career Knowledge");
		else if (row.applicationId && row.applicationId !== applicationId)
			blocked.set(id, "Private to another application");
	}
	return blocked;
}

/** The user's stated direction: target roles, what matters to them, and organizations they want. */
async function emphasisOf(userId: string) {
	const [row] = await db
		.select({ data: tables.careerProfile.data })
		.from(tables.careerProfile)
		.where(eq(tables.careerProfile.userId, userId));
	const profile = careerProfileDataSchema.parse(row?.data ?? {});
	const wanted =
		profile.structured?.organization.filter((item) => item.stance === "want").map((item) => item.value) ?? [];
	const text = [...profile.targetRoles, profile.priorities, ...wanted].join(" ; ");
	return { text, tokens: tokens(text) };
}

async function stored(userId: string, applicationId: string) {
	const [row] = await db
		.select()
		.from(tables.resumeSelection)
		.where(and(eq(tables.resumeSelection.userId, userId), eq(tables.resumeSelection.applicationId, applicationId)));
	return row ?? null;
}

/** Everything a selection needs, from the full profile through to the plan. Exported for tests. */
export async function buildSelection(input: {
	applicationId: string;
	analysis: JobAnalysis;
	profile: MasterProfile;
	blocked: Blocked;
	emphasis: { text: string; tokens: Set<string> };
	previous: ResumeSelectionPlan | null;
	review: (prompt: string) => Promise<{ output: unknown; model: string } | null>;
	now: Date;
}) {
	const { profile, unavailable } = eligibleProfile(input.profile, input.blocked);
	const achievementCount =
		profile.entries.reduce((sum, entry) => sum + entry.achievements.length, 0) + profile.standalone.length;
	if (achievementCount === 0)
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Your master profile has no achievements to choose from. Add some in Career → Knowledge → Profile first.",
		});
	const requirements = requirementTerms(input.analysis, profile.skills);
	const context = { analysis: input.analysis, requirements, emphasis: input.emphasis.tokens, now: input.now };
	const ranked = rankEvidence(profile, context);
	const short = shortlist(ranked, requirements);
	const { prompt, keys } = reviewPrompt({
		analysis: input.analysis,
		entries: profile.entries,
		shortlist: short,
		omitted: ranked.length - short.length,
		skills: profile.skills,
		context,
		positioning: input.emphasis.text,
	});

	let review: Review = EMPTY_REVIEW;
	let source: ResumeSelectionPlan["source"] = "ranking";
	let model = "";
	const answer = await input.review(prompt);
	if (answer) {
		const parsed = reviewOutputSchema.safeParse(answer.output);
		if (parsed.success) {
			review = resolveReview(
				parsed.data,
				keys,
				new Set(input.analysis.requirements.map((requirement) => requirement.id)),
			);
			source = review.achievements.size > 0 ? "ai" : "ranking";
		}
		model = answer.model;
	}

	const base = {
		applicationId: input.applicationId,
		analysis: input.analysis,
		profile,
		unavailable,
		ranked,
		review,
		source,
		context,
		now: input.now,
	};
	const proposed = composePlan(base);
	const plan = input.previous ? composePlan({ ...base, previous: input.previous }) : proposed;
	if (source === "ranking")
		for (const item of [proposed, plan])
			item.warnings.unshift("The AI review didn't return a usable answer, so this plan comes from the ranking alone.");
	return { proposed, plan, model, shortlisted: short.length, ranked: ranked.length };
}

export const selectionService = {
	get: async (userId: string, applicationId: string) => {
		const application = await applicationService.getById({ id: applicationId, userId });
		const row = await stored(userId, applicationId);
		if (!row) return null;
		const profile = await masterProfileService.get(userId);
		const ids = new Set([
			...profile.entries.flatMap((entry) => [entry.id, ...entry.achievements.map((item) => item.id)]),
			...profile.standalone.map((item) => item.id),
		]);
		const planned = new Set([
			...row.plan.entries.flatMap((entry) => [entry.entryId, ...entry.achievements.map((item) => item.achievementId)]),
			...row.plan.standalone.map((item) => item.achievementId),
			...row.plan.unavailable.map((item) => item.id),
		]);
		return {
			analysis: row.analysis,
			plan: row.plan,
			proposed: row.proposed,
			postingText: row.postingText,
			model: row.model,
			updatedAt: row.updatedAt,
			/** The application's posting no longer matches what was analysed. */
			postingChanged: postingHash(application.jobDescription ?? "") !== row.analysis.postingHash,
			/** Profile records were added or removed since the plan was made. */
			profileChanged: [...ids].some((id) => !planned.has(id)) || [...planned].some((id) => !ids.has(id)),
		};
	},

	/** Analyses the posting (unless already analysed and unchanged) and proposes a selection plan. */
	propose: async (
		userId: string,
		input: { applicationId: string; reanalyze?: boolean | undefined; quality?: "standard" | "thorough" | undefined },
		options: Options = {},
	) => {
		const usage: TokenUsage[] = [];
		const ask = options.ask ?? askDefaultModel;
		const now = options.now ?? new Date();
		const application = await applicationService.getById({ id: input.applicationId, userId });
		const posting = application.jobDescription?.trim() ?? "";
		const extracted = application.requirements ?? [];
		if (!posting && extracted.length === 0)
			throw new ORPCError("BAD_REQUEST", {
				message: "This application has no posting saved. Add the job posting to the application first.",
			});
		const previous = await stored(userId, input.applicationId);

		let analysis = previous?.analysis ?? null;
		let analysisModel = previous?.model ?? "";
		if (!analysis || input.reanalyze || analysis.postingHash !== postingHash(posting)) {
			const prompt = { role: application.role, company: application.company, posting, extracted };
			const answer = await ask({
				userId,
				task: "extraction",
				quality: input.quality,
				system: ANALYSIS_SYSTEM,
				prompt: analysisPrompt(prompt),
				schema: analysisOutputSchema,
				signal: options.signal,
			});
			analysis = normalizeAnalysis(answer.output, { ...prompt, model: answer.model, now });
			analysisModel = answer.model;
			usage.push(usageOf("analysis", "extraction", answer));
		}
		if (analysis.requirements.length === 0)
			throw new ORPCError("BAD_REQUEST", {
				message: "No requirements could be read from this posting. Check the posting text and try again.",
			});

		const [profile, blocked, emphasis] = await Promise.all([
			masterProfileService.get(userId),
			blockedRecords(userId, input.applicationId),
			emphasisOf(userId),
		]);
		const selection = await buildSelection({
			applicationId: input.applicationId,
			analysis,
			profile,
			blocked,
			emphasis,
			previous: previous?.plan ?? null,
			now,
			review: async (prompt) => {
				try {
					const answer = await ask({
						userId,
						task: "evidence",
						quality: input.quality,
						system: REVIEW_SYSTEM,
						prompt,
						schema: reviewOutputSchema,
						signal: options.signal,
					});
					usage.push(usageOf("review", "evidence", answer));
					return answer;
				} catch (error) {
					// An unreadable answer falls back to the ranking; connection problems are reported.
					if (error instanceof ORPCError && error.code === "INTERNAL_SERVER_ERROR") return null;
					throw error;
				}
			},
		});

		for (const item of [selection.proposed, selection.plan]) item.usage = usage;
		const values = {
			postingText: posting,
			analysis,
			proposed: selection.proposed,
			plan: selection.plan,
			model: selection.model || analysisModel,
		};
		await db
			.insert(tables.resumeSelection)
			.values({ userId, applicationId: input.applicationId, ...values })
			.onConflictDoUpdate({
				target: [tables.resumeSelection.userId, tables.resumeSelection.applicationId],
				set: { ...values, updatedAt: now },
			});
		return selectionService.get(userId, input.applicationId);
	},

	/** Saves the user's review: include flags and order. The profile itself is never changed. */
	update: async (userId: string, edit: SelectionEdit) => {
		const row = await stored(userId, edit.applicationId);
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Propose a selection for this application first." });
		const plan = applyEdit(row.plan, row.proposed, edit, row.analysis);
		await db.update(tables.resumeSelection).set({ plan }).where(eq(tables.resumeSelection.id, row.id));
		return selectionService.get(userId, edit.applicationId);
	},

	/** Back to the proposal, dropping the user's edits. */
	reset: async (userId: string, applicationId: string) => {
		const row = await stored(userId, applicationId);
		if (!row) throw new ORPCError("NOT_FOUND");
		await db
			.update(tables.resumeSelection)
			.set({ plan: finalize(structuredClone(row.proposed), row.analysis) })
			.where(eq(tables.resumeSelection.id, row.id));
		return selectionService.get(userId, applicationId);
	},

	/** The reviewed plan, for building a resume. */
	plan: async (userId: string, applicationId: string) => (await stored(userId, applicationId))?.plan ?? null,
};
