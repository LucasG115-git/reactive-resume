import type { ModelOutput } from "./prompt";
import type { AssembleInput, ProfileAssemblyResult } from "@reactive-resume/schema/master-profile";
import { ORPCError } from "@orpc/client";
import { APICallError, RetryError } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { parseResumeDataForWrite } from "@reactive-resume/schema/resume/write";
import { aiProvidersService } from "../../ai-providers/service";
import { generateJson } from "../../ai/generate-json";
import { getModel } from "../../ai/service";
import { applicationService } from "../../applications/service";
import { documentsService } from "../../documents/service";
import { resumeService } from "../../resume/service";
import { masterProfileService } from "../service";
import { buildResume } from "./build";
import { buildCatalog, buildPrompt, modelOutputSchema, resolveOutput, SYSTEM_PROMPT } from "./prompt";

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

export const assembleService = {
	assemble: async (
		userId: string,
		input: AssembleInput,
		options: { select?: SelectEvidence; signal?: AbortSignal | undefined; now?: Date } = {},
	): Promise<AssembleResponse> => {
		const application = await applicationService.getById({ id: input.applicationId, userId });
		const base = await resumeService.getById({ id: input.baseResumeId, userId });
		const profile = await masterProfileService.get(userId);

		const catalog = buildCatalog(profile);
		if (catalog.achievementIds.size === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Your master profile has no achievements yet. Add some in Career → Knowledge → Profile first.",
			});
		}

		const select = options.select ?? selectWithDefaultProvider;
		const { output, model } = await select({
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

		const { selection, coverage } = resolveOutput(output, catalog);
		const built = buildResume({
			base: base.data,
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
		const resumeId = await documentsService.copyForJob({
			userId,
			resumeId: base.id,
			applicationId: application.id,
			name: input.name ?? `${application.role || "Resume"} — ${application.company || "Tailored"}`,
		});
		await resumeService.update({ id: resumeId, userId, data: parseResumeDataForWrite(built.data) });

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
