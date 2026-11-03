import type z from "zod";
import { ORPCError } from "@orpc/client";
import { APICallError, RetryError } from "ai";
import { aiProvidersService } from "../../ai-providers/service";
import { generateJson } from "../../ai/generate-json";
import { getModel } from "../../ai/service";

/** Asks the user's default AI connection for JSON. Swappable so tests run the whole flow without a provider. */
export type AskModel = <T>(input: {
	userId: string;
	system: string;
	prompt: string;
	schema: z.ZodType<T>;
	signal?: AbortSignal | undefined;
}) => Promise<{ output: T; model: string }>;

export const askDefaultModel: AskModel = async ({ userId, system, prompt, schema, signal }) => {
	const provider = await aiProvidersService.getDefaultRunnable({ userId });
	if (!provider)
		throw new ORPCError("BAD_REQUEST", {
			message: "No AI provider is set up. Add one in Settings → AI & developer to tailor a resume.",
		});
	const model = getModel({
		provider: provider.provider,
		model: provider.model,
		apiKey: provider.apiKey,
		...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
	});
	try {
		const output = await generateJson(model, { system, prompt }, schema, signal);
		return { output, model: `${provider.provider}/${provider.model}` };
	} catch (error) {
		if (APICallError.isInstance(error) || (RetryError.isInstance(error) && error.reason === "maxRetriesExceeded"))
			throw new ORPCError("BAD_GATEWAY", {
				message: "Couldn't reach the AI provider. Check its settings and try again.",
				cause: error,
			});
		throw error;
	}
};
