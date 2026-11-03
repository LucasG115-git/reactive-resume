import type { AiTask, AiTaskSettings } from "@reactive-resume/schema/ai-tasks";
import type z from "zod";
import { ORPCError } from "@orpc/client";
import { APICallError, RetryError } from "ai";
import { isUnavailableModel, resolveTask } from "../../ai-tasks/resolve";
import { generateJson } from "../../ai/generate-json";

export type AskResult<T> = {
	output: T;
	/** "provider/model" that answered. */
	model: string;
	usage?: { inputTokens: number; outputTokens: number } | undefined;
	/** The configured model wasn't available, so the connection's own model answered. */
	fallback?: boolean | undefined;
	/** Anything about the setting worth telling the user. */
	notes?: string[] | undefined;
};

/** Asks the model configured for a task for JSON. Swappable so tests run the whole flow without a provider. */
export type AskModel = <T>(input: {
	userId: string;
	task: AiTask;
	quality?: AiTaskSettings["quality"] | undefined;
	system: string;
	prompt: string;
	schema: z.ZodType<T>;
	signal?: AbortSignal | undefined;
}) => Promise<AskResult<T>>;

const reachable = (error: unknown) => {
	if (APICallError.isInstance(error) || (RetryError.isInstance(error) && error.reason === "maxRetriesExceeded"))
		return new ORPCError("BAD_GATEWAY", {
			message: "Couldn't reach the AI provider. Check its settings and try again.",
			cause: error,
		});
	return error;
};

export const askDefaultModel: AskModel = async ({ userId, task, quality, system, prompt, schema, signal }) => {
	const resolved = await resolveTask(userId, task, quality);
	let usage: AskResult<unknown>["usage"];
	const onUsage = (value: { inputTokens?: number | undefined; outputTokens?: number | undefined }) => {
		usage = { inputTokens: value.inputTokens ?? 0, outputTokens: value.outputTokens ?? 0 };
	};
	try {
		const output = await generateJson(resolved.model, { system, prompt }, schema, signal, {
			providerOptions: resolved.providerOptions,
			onUsage,
		});
		return { output, model: resolved.label, usage, notes: resolved.notes };
	} catch (error) {
		// A model name the provider doesn't know falls back to the connection's own model, and says so.
		if (resolved.fallback && isUnavailableModel(error)) {
			try {
				const output = await generateJson(resolved.fallback.model, { system, prompt }, schema, signal, { onUsage });
				return {
					output,
					model: resolved.fallback.label,
					usage,
					fallback: true,
					notes: [...resolved.notes, `${resolved.label} wasn't available, so ${resolved.fallback.label} was used.`],
				};
			} catch (fallbackError) {
				throw reachable(fallbackError);
			}
		}
		throw reachable(error);
	}
};
