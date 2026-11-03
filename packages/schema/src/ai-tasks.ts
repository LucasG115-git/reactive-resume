import z from "zod";

/**
 * Which model each kind of AI work uses. Each task can use a saved AI connection and a model name of its own;
 * anything left unset uses the default connection and its model, so nothing changes until the user chooses.
 */

export const AI_TASKS = ["extraction", "evidence", "writing", "polish", "review"] as const;
export const aiTaskSchema = z.enum(AI_TASKS);
export type AiTask = z.infer<typeof aiTaskSchema>;

/** Tasks the Thorough model replaces, when one is set. Extraction and polishing stay on their own models. */
export const THOROUGH_TASKS: readonly AiTask[] = ["evidence", "writing", "review"];

export const REASONING_EFFORTS = ["default", "low", "medium", "high"] as const;

export const taskModelSchema = z.object({
	/** A saved AI connection's id; null uses the default connection. */
	providerId: z.string().min(1).nullable().default(null),
	/** A model name on that connection; null uses the connection's own model. */
	model: z.string().trim().min(1).max(200).nullable().default(null),
	/** Sent only to providers that accept it (OpenAI and OpenAI-compatible connections). */
	reasoningEffort: z.enum(REASONING_EFFORTS).default("default"),
	/** The last capability check of this setting. */
	lastTest: z
		.object({
			at: z.iso.datetime({ offset: true }),
			model: z.string(),
			ok: z.boolean(),
			json: z.boolean(),
			tools: z.boolean(),
			reasoning: z.enum(["accepted", "rejected", "not-sent"]),
			latencyMs: z.number(),
			message: z.string(),
		})
		.nullable()
		.default(null),
});
export type TaskModel = z.infer<typeof taskModelSchema>;

const unset = () => taskModelSchema.parse({});

export const aiTaskSettingsSchema = z.object({
	version: z.literal(1).default(1),
	/** standard: each task's own model. thorough: the Thorough model for evidence, writing and review. */
	quality: z.enum(["standard", "thorough"]).default("standard"),
	tasks: z
		.object({
			extraction: taskModelSchema.default(unset),
			evidence: taskModelSchema.default(unset),
			writing: taskModelSchema.default(unset),
			polish: taskModelSchema.default(unset),
			review: taskModelSchema.default(unset),
		})
		.default({ extraction: unset(), evidence: unset(), writing: unset(), polish: unset(), review: unset() }),
	thorough: taskModelSchema.default(unset),
});
export type AiTaskSettings = z.infer<typeof aiTaskSettingsSchema>;
export const DEFAULT_AI_TASK_SETTINGS: AiTaskSettings = aiTaskSettingsSchema.parse({});

/** What each task does, for the settings page. */
export const TASK_DESCRIPTIONS: Record<AiTask, string> = {
	extraction: "Reading postings and files into fields and ranked requirements",
	evidence: "Reviewing which of your achievements fit a posting",
	writing: "Writing tailored resumes from your reviewed selection",
	polish: "Short rewrites: application answers, replies and Fit notes",
	review: "Reviewing a finished resume for relevance, strength and tone",
};

/**
 * Suggested models for OpenAI connections. Suggestions only: they're filled in when the user asks, and each is
 * checked before use.
 */
export const SUGGESTED_OPENAI_MODELS: Record<AiTask | "thorough", string> = {
	extraction: "gpt-6-luna",
	evidence: "gpt-6.1-sol",
	writing: "gpt-6.1-sol",
	polish: "gpt-6.1-terra",
	review: "gpt-6.1-sol",
	thorough: "gpt-6-astra",
};

/**
 * Roughly how many tokens one tailored resume sends and receives at each step, before any profile-size effect.
 * Shown as relative usage; actual counts are recorded with each run.
 */
export const TASK_TOKEN_ESTIMATES = {
	analysis: { task: "extraction", input: 6_000, output: 1_200 },
	review: { task: "evidence", input: 14_000, output: 3_000 },
	writing: { task: "writing", input: 7_000, output: 2_000 },
} as const satisfies Record<string, { task: AiTask; input: number; output: number }>;

/** The model setting a task uses in a quality mode. */
export function taskSetting(settings: AiTaskSettings, task: AiTask, quality: AiTaskSettings["quality"]): TaskModel {
	if (
		quality === "thorough" &&
		THOROUGH_TASKS.includes(task) &&
		(settings.thorough.model || settings.thorough.providerId)
	)
		return settings.thorough;
	return settings.tasks[task];
}

export const tokenUsageSchema = z.object({
	step: z.string(),
	task: aiTaskSchema,
	/** "provider/model" that answered. */
	model: z.string(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	/** The configured model wasn't available and the connection's own model answered instead. */
	fallback: z.boolean().default(false),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
