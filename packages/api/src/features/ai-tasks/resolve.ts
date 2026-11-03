import type { ProviderOptions } from "../ai/generate-json";
import type { AiTask, AiTaskSettings, TaskModel } from "@reactive-resume/schema/ai-tasks";
import { ORPCError } from "@orpc/client";
import { APICallError } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { aiTaskSettingsSchema, DEFAULT_AI_TASK_SETTINGS, taskSetting } from "@reactive-resume/schema/ai-tasks";
import { aiProvidersService } from "../ai-providers/service";
import { getModel } from "../ai/service";

export async function taskSettings(userId: string): Promise<AiTaskSettings> {
	const [row] = await db
		.select({ data: tables.aiTaskSettings.data })
		.from(tables.aiTaskSettings)
		.where(eq(tables.aiTaskSettings.userId, userId));
	const parsed = aiTaskSettingsSchema.safeParse(row?.data ?? {});
	return parsed.success ? parsed.data : structuredClone(DEFAULT_AI_TASK_SETTINGS);
}

type Runnable = NonNullable<Awaited<ReturnType<typeof aiProvidersService.getDefaultRunnable>>>;

type Model = ReturnType<typeof getModel>;

export type ResolvedModel = {
	model: Model;
	/** "provider/model". */
	label: string;
	providerOptions: ProviderOptions;
	/** The connection's own model, to fall back to when the configured one isn't available. */
	fallback: { model: Model; label: string } | null;
	/** Why the configured setting couldn't be used as it is. */
	notes: string[];
};

const OPENAI_LIKE = new Set(["openai", "openai-compatible", "vercel-ai-gateway", "openrouter"]);

/** Provider options for a reasoning-effort setting, for providers that accept one; others get none. */
export function reasoningOptions(provider: string, effort: TaskModel["reasoningEffort"]): ProviderOptions {
	if (effort === "default" || !OPENAI_LIKE.has(provider)) return undefined;
	return provider === "openai" ? { openai: { reasoningEffort: effort } } : { [provider]: { reasoningEffort: effort } };
}

const modelOf = (provider: Runnable, name: string) =>
	getModel({
		provider: provider.provider,
		model: name,
		apiKey: provider.apiKey,
		...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
	});

/** A setting's connection and model, ready to call. Unset parts use the default connection and its model. */
export async function resolveSetting(userId: string, setting: TaskModel): Promise<ResolvedModel> {
	const notes: string[] = [];
	let provider: Runnable | null = null;
	if (setting.providerId) {
		try {
			provider = await aiProvidersService.getRunnableById({ id: setting.providerId, userId });
		} catch {
			notes.push("The chosen AI connection isn't available, so the default connection was used.");
		}
	}
	provider ??= await aiProvidersService.getDefaultRunnable({ userId });
	if (!provider)
		throw new ORPCError("BAD_REQUEST", { message: "No AI provider is set up. Add one in Settings → AI & developer." });
	const name = setting.model ?? provider.model;
	return {
		model: modelOf(provider, name),
		label: `${provider.provider}/${name}`,
		providerOptions: reasoningOptions(provider.provider, setting.reasoningEffort),
		fallback:
			name === provider.model
				? null
				: { model: modelOf(provider, provider.model), label: `${provider.provider}/${provider.model}` },
		notes,
	};
}

/** The model a task uses for this user in a quality mode. */
export async function resolveTask(userId: string, task: AiTask, quality?: AiTaskSettings["quality"]) {
	const settings = await taskSettings(userId);
	return resolveSetting(userId, taskSetting(settings, task, quality ?? settings.quality));
}

/** A provider's way of saying the model name doesn't exist or isn't available to this key. */
export function isUnavailableModel(error: unknown) {
	if (!APICallError.isInstance(error)) return false;
	if (error.statusCode === 404) return true;
	const text = `${error.message} ${error.responseBody ?? ""}`.toLowerCase();
	return (
		(error.statusCode === 400 || error.statusCode === 403) &&
		/model/.test(text) &&
		/(not found|does not exist|unknown|invalid|not available|no access|unsupported)/.test(text)
	);
}
