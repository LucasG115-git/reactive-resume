import type { AskModel } from "../selection/model";
import type { BenchmarkConfig } from "./run";
import type { PriceTable } from "./score";
import type { AIProvider } from "@reactive-resume/ai/types";
import type { AiTask, TaskModel } from "@reactive-resume/schema/ai-tasks";
import { readFile } from "node:fs/promises";
import z from "zod";
import { aiProviderSchema } from "@reactive-resume/ai/types";
import { AI_TASKS, REASONING_EFFORTS } from "@reactive-resume/schema/ai-tasks";
import { reasoningOptions } from "../../ai-tasks/resolve";
import { generateJson } from "../../ai/generate-json";
import { getModel } from "../../ai/service";

/**
 * Live benchmark configurations, read from a JSON file named by RESUME_BENCHMARK_CONFIG. API keys are never in the
 * file: each configuration names the environment variable holding its key. Example:
 *
 * {
 *   "prices": { "openai/gpt-6-luna": { "input": 0.2, "output": 0.8 } },
 *   "configs": [{
 *     "label": "Tiered OpenAI",
 *     "provider": "openai",
 *     "apiKeyEnv": "OPENAI_API_KEY",
 *     "models": { "extraction": "gpt-6-luna", "evidence": "gpt-6.1-sol", "writing": "gpt-6.1-sol", "review": "gpt-6.1-sol" },
 *     "reasoningEffort": { "writing": "medium" },
 *     "analyze": true, "review": true, "render": true
 *   }]
 * }
 */
const liveConfigSchema = z.object({
	prices: z.record(z.string(), z.object({ input: z.number(), output: z.number() })).default({}),
	configs: z
		.array(
			z.object({
				label: z.string().min(1),
				provider: aiProviderSchema,
				baseURL: z.string().optional(),
				apiKeyEnv: z.string().min(1),
				/** A model per task; "default" is used for any task not listed. */
				models: z.partialRecord(z.enum([...AI_TASKS, "default"]), z.string().min(1)),
				reasoningEffort: z.partialRecord(z.enum(AI_TASKS), z.enum(REASONING_EFFORTS)).default({}),
				quality: z.enum(["standard", "thorough"]).default("standard"),
				analyze: z.boolean().default(true),
				review: z.boolean().default(true),
				render: z.boolean().default(false),
			}),
		)
		.min(1),
});

function askFor(input: {
	provider: AIProvider;
	apiKey: string;
	baseURL?: string | undefined;
	models: Partial<Record<AiTask | "default", string>>;
	efforts: Partial<Record<AiTask, TaskModel["reasoningEffort"]>>;
}): AskModel {
	return async ({ task, system, prompt, schema, signal }) => {
		const name = input.models[task] ?? input.models.default;
		if (!name) throw new Error(`No model set for ${task}.`);
		const model = getModel({
			provider: input.provider,
			model: name,
			apiKey: input.apiKey,
			...(input.baseURL ? { baseURL: input.baseURL } : {}),
		});
		let usage: { inputTokens: number; outputTokens: number } | undefined;
		const output = await generateJson(model, { system, prompt }, schema, signal, {
			providerOptions: reasoningOptions(input.provider, input.efforts[task] ?? "default"),
			onUsage: (value) => {
				usage = { inputTokens: value.inputTokens ?? 0, outputTokens: value.outputTokens ?? 0 };
			},
		});
		return { output, model: `${input.provider}/${name}`, usage };
	};
}

export async function loadLiveConfigs(path: string): Promise<{ configs: BenchmarkConfig[]; prices: PriceTable }> {
	const parsed = liveConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
	return {
		prices: parsed.prices,
		configs: parsed.configs.map((config) => {
			const apiKey = process.env[config.apiKeyEnv];
			if (!apiKey) throw new Error(`Set ${config.apiKeyEnv} for "${config.label}".`);
			return {
				label: config.label,
				ask: askFor({
					provider: config.provider,
					apiKey,
					baseURL: config.baseURL,
					models: config.models,
					efforts: config.reasoningEffort,
				}),
				quality: config.quality,
				analyze: config.analyze,
				review: config.review,
				render: config.render,
			};
		}),
	};
}
