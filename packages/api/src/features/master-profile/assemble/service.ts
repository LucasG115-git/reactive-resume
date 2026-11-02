import type { Selection } from "./build";
import type { Coverage, ModelOutput } from "./prompt";
import type { AssembleInput, ProfileAssemblyResult } from "@reactive-resume/schema/master-profile";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/client";
import { APICallError, RetryError } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { parseResumeDataForWrite } from "@reactive-resume/schema/resume/write";
import { aiProvidersService } from "../../ai-providers/service";
import { generateJson } from "../../ai/generate-json";
import { getModel } from "../../ai/service";
import { applicationService } from "../../applications/service";
import { documentsService } from "../../documents/service";
import { resumeService } from "../../resume/service";
import { selectionService } from "../selection/service";
import { masterProfileService } from "../service";
import { buildResume } from "./build";
import {
	buildCatalog,
	buildPrompt,
	buildWritePrompt,
	modelOutputSchema,
	plannedProfile,
	resolveOutput,
	SYSTEM_PROMPT,
	WRITE_SYSTEM_PROMPT,
} from "./prompt";

/** Asks a model for a selection. Swappable so tests can run the whole flow without a provider. */
export type SelectEvidence = (input: {
	userId: string;
	system: string;
	prompt: string;
	signal?: AbortSignal | undefined;
}) => Promise<{ output: ModelOutput; model: string }>;

const selectWithDefaultProvider: SelectEvidence = async ({ userId, system, prompt, signal }) => {
	const provider = await aiProvidersService.getDefaultRunnable({ userId });
	if (!provider) {
		throw new ORPCError("BAD_REQUEST", {
			message: "No AI provider is set up. Add one in Settings → AI & developer to assemble a resume.",
		});
	}
	const model = getModel({
		provider: provider.provider,
		model: provider.model,
		apiKey: provider.apiKey,
		...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
	});
	try {
		const output = await generateJson(model, { system, prompt }, modelOutputSchema, signal);
		return { output, model: `${provider.provider}/${provider.model}` };
	} catch (error) {
		if (APICallError.isInstance(error) || (RetryError.isInstance(error) && error.reason === "maxRetriesExceeded")) {
			throw new ORPCError("BAD_GATEWAY", {
				message: "Couldn't reach the AI provider. Check its settings and try again.",
				cause: error,
			});
		}
		throw error;
	}
};

export type AssembleResponse = {
	assemblyId: string;
	resumeId: string;
	result: ProfileAssemblyResult;
};

/** The default template with the account's name and email, for a resume assembled without a base. */
async function starterResume(userId: string): Promise<ResumeData> {
	const [owner] = await db
		.select({ name: tables.user.name, email: tables.user.email })
		.from(tables.user)
		.where(eq(tables.user.id, userId));
	const data = structuredClone(defaultResumeData);
	data.basics.name = owner?.name ?? "";
	data.basics.email = owner?.email ?? "";
	return data;
}

export const assembleService = {
	assemble: async (
		userId: string,
		input: AssembleInput,
		options: { select?: SelectEvidence; signal?: AbortSignal | undefined; now?: Date } = {},
	): Promise<AssembleResponse> => {
		const application = await applicationService.getById({ id: input.applicationId, userId });
		const base = input.baseResumeId ? await resumeService.getById({ id: input.baseResumeId, userId }) : null;
		const profile = await masterProfileService.get(userId);

		const catalog = buildCatalog(profile);
		if (catalog.achievementIds.size === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Your master profile has no achievements yet. Add some in Career → Knowledge → Profile first.",
			});
		}

		const select = options.select ?? selectWithDefaultProvider;
		// With a reviewed Resume Selection Plan, the plan decides what goes in; the AI only words it.
		const stored = input.usePlan === false ? null : await selectionService.get(userId, application.id);
		const plan = stored?.plan ?? null;
		let selection: Selection;
		let coverage: Coverage;
		let model = "";
		if (plan) {
			const planned = plannedProfile(profile, plan);
			const plannedCatalog = buildCatalog(planned);
			if (plannedCatalog.achievementIds.size === 0)
				throw new ORPCError("BAD_REQUEST", {
					message: "The selection for this application has no achievements included. Include some, then try again.",
				});
			if (input.mode === "verbatim") selection = { achievements: [], skills: [], summary: "" };
			else {
				const answer = await select({
					userId,
					system: WRITE_SYSTEM_PROMPT,
					prompt: buildWritePrompt({
						catalog: plannedCatalog,
						company: application.company,
						role: application.role,
						requirements: stored?.analysis.requirements.map((requirement) => requirement.text) ?? [],
						positioning: plan.positioning,
					}),
					signal: options.signal,
				});
				selection = resolveOutput(answer.output, plannedCatalog).selection;
				model = answer.model;
			}
			coverage = plan.coverage.map((item) => ({
				requirement:
					stored?.analysis.requirements.find((requirement) => requirement.id === item.requirementId)?.text ??
					item.requirementId,
				strength: item.status === "supported" ? "strong" : item.status === "partial" ? "partial" : "none",
				achievementIds: item.achievementIds,
				skillIds: item.skillIds,
			}));
		} else {
			const answer = await select({
				userId,
				system: SYSTEM_PROMPT,
				prompt: buildPrompt({
					catalog,
					mode: input.mode,
					company: application.company,
					role: application.role,
					requirements: application.requirements ?? [],
					jobDescription: application.jobDescription ?? "",
				}),
				signal: options.signal,
			});
			({ selection, coverage } = resolveOutput(answer.output, catalog));
			model = answer.model;
		}
		const built = buildResume({
			plan,
			base: base?.data ?? (await starterResume(userId)),
			profile,
			selection,
			mode: input.mode,
			now: options.now ?? new Date(),
		});
		if (built.bullets.length === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"The AI didn't choose anything from your profile for this posting. Check the posting text and try again.",
			});
		}

		// Copy the base for this job (linking it like "Copy for a job" does), then write the assembled content.
		const name = input.name ?? `${application.role || "Resume"} — ${application.company || "Tailored"}`;
		const data = parseResumeDataForWrite(built.data);
		let resumeId: string;
		if (base) {
			resumeId = await documentsService.copyForJob({ userId, resumeId: base.id, applicationId: application.id, name });
			await resumeService.update({ id: resumeId, userId, data });
		} else resumeId = await documentsService.createForJob({ userId, applicationId: application.id, name, data });

		const result: ProfileAssemblyResult = {
			coverage,
			bullets: built.bullets,
			entryIds: built.entryIds,
			skillIds: built.skillIds,
			summaryUsed: built.summaryUsed,
			warnings: built.warnings,
		};
		const [assembly] = await db
			.insert(tables.profileAssembly)
			.values({ userId, applicationId: application.id, resumeId, mode: input.mode, model, result })
			.returning({ id: tables.profileAssembly.id });
		if (!assembly) throw new ORPCError("INTERNAL_SERVER_ERROR");

		return { assemblyId: assembly.id, resumeId, result };
	},

	/** The most recent assembly for an application, for its coverage report. */
	latest: async (userId: string, applicationId: string) => {
		const [row] = await db
			.select()
			.from(tables.profileAssembly)
			.where(and(eq(tables.profileAssembly.userId, userId), eq(tables.profileAssembly.applicationId, applicationId)))
			.orderBy(desc(tables.profileAssembly.createdAt))
			.limit(1);
		return row ?? null;
	},
};
