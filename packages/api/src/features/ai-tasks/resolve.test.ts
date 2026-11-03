import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { APICallError } from "ai";
import { aiTaskSettingsSchema, DEFAULT_AI_TASK_SETTINGS, taskSetting } from "@reactive-resume/schema/ai-tasks";

const mocks = vi.hoisted(() => ({
	settings: null as unknown,
	byId: vi.fn(),
	fallbackDefault: vi.fn(),
	generate: vi.fn(),
}));

vi.mock("@reactive-resume/db/client", () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => (mocks.settings ? [{ data: mocks.settings }] : []) }) }),
	},
}));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: { getRunnableById: mocks.byId, getDefaultRunnable: mocks.fallbackDefault },
}));
vi.mock("../ai/service", () => ({ getModel: (input: { model: string }) => ({ name: input.model }) }));
vi.mock("../ai/generate-json", () => ({ generateJson: mocks.generate }));

const { isUnavailableModel, reasoningOptions, resolveTask } = await import("./resolve");
const { askDefaultModel } = await import("../master-profile/selection/model");

const connection = (id: string, model: string) => ({
	id,
	provider: "openai",
	model,
	apiKey: "test-key",
	baseURL: null,
});

const apiError = (statusCode: number, message: string) =>
	new APICallError({ message, url: "https://example.test", requestBodyValues: {}, statusCode });

beforeEach(() => {
	mocks.settings = null;
	mocks.byId.mockReset();
	mocks.fallbackDefault.mockReset().mockResolvedValue(connection("default", "base-model"));
	mocks.generate.mockReset();
});

describe("taskSetting", () => {
	const settings = aiTaskSettingsSchema.parse({
		tasks: { writing: { model: "standard-writer" }, extraction: { model: "fast-reader" } },
		thorough: { model: "deep-model" },
	});

	it("uses each task's own setting in standard mode", () => {
		expect(taskSetting(settings, "writing", "standard").model).toBe("standard-writer");
	});

	it("uses the thorough model only for the tasks that benefit from it", () => {
		expect(taskSetting(settings, "writing", "thorough").model).toBe("deep-model");
		expect(taskSetting(settings, "extraction", "thorough").model).toBe("fast-reader");
	});

	it("stays on the standard setting when no thorough model is set", () => {
		expect(taskSetting(DEFAULT_AI_TASK_SETTINGS, "writing", "thorough").model).toBeNull();
	});
});

describe("reasoningOptions", () => {
	it("sends reasoning effort only to providers that accept it", () => {
		expect(reasoningOptions("openai", "high")).toEqual({ openai: { reasoningEffort: "high" } });
		expect(reasoningOptions("openai", "default")).toBeUndefined();
		expect(reasoningOptions("anthropic", "high")).toBeUndefined();
	});
});

describe("isUnavailableModel", () => {
	it("recognises unknown model names", () => {
		expect(isUnavailableModel(apiError(404, "Not found"))).toBe(true);
		expect(isUnavailableModel(apiError(400, "The model `gpt-x` does not exist"))).toBe(true);
	});

	it("leaves other failures alone", () => {
		expect(isUnavailableModel(apiError(401, "Invalid API key"))).toBe(false);
		expect(isUnavailableModel(apiError(400, "Prompt too long"))).toBe(false);
		expect(isUnavailableModel(new Error("model not found"))).toBe(false);
	});
});

describe("resolveTask", () => {
	it("uses the default connection and its model when nothing is configured", async () => {
		const resolved = await resolveTask("user", "writing");
		expect(resolved.label).toBe("openai/base-model");
		expect(resolved.fallback).toBeNull();
	});

	it("uses a configured model name with the connection's own model as fallback", async () => {
		mocks.settings = { tasks: { writing: { model: "gpt-6.1-sol", reasoningEffort: "medium" } } };
		const resolved = await resolveTask("user", "writing");
		expect(resolved.label).toBe("openai/gpt-6.1-sol");
		expect(resolved.fallback?.label).toBe("openai/base-model");
		expect(resolved.providerOptions).toEqual({ openai: { reasoningEffort: "medium" } });
	});

	it("never switches to the thorough model unless asked", async () => {
		mocks.settings = { thorough: { model: "gpt-6-astra" } };
		expect((await resolveTask("user", "writing")).label).toBe("openai/base-model");
		expect((await resolveTask("user", "writing", "thorough")).label).toBe("openai/gpt-6-astra");
	});

	it("falls back to the default connection when the chosen one is gone, and says so", async () => {
		mocks.settings = { tasks: { polish: { providerId: "removed" } } };
		mocks.byId.mockRejectedValue(new Error("not found"));
		const resolved = await resolveTask("user", "polish");
		expect(resolved.label).toBe("openai/base-model");
		expect(resolved.notes[0]).toMatch(/default connection/);
	});
});

describe("askDefaultModel", () => {
	it("retries with the connection's model when the configured one isn't available", async () => {
		mocks.settings = { tasks: { evidence: { model: "gpt-unknown" } } };
		mocks.generate
			.mockRejectedValueOnce(apiError(404, "model not found"))
			.mockImplementationOnce(async (_model, _prompt, _schema, _signal, options) => {
				options?.onUsage?.({ inputTokens: 10, outputTokens: 2 });
				return { ok: true };
			});
		const answer = await askDefaultModel({
			userId: "user",
			task: "evidence",
			system: "s",
			prompt: "p",
			schema: aiTaskSettingsSchema as never,
		});
		expect(answer.fallback).toBe(true);
		expect(answer.model).toBe("openai/base-model");
		expect(answer.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
		expect(answer.notes?.at(-1)).toMatch(/wasn't available/);
	});

	it("reports other provider errors without falling back", async () => {
		mocks.settings = { tasks: { evidence: { model: "gpt-6.1-sol" } } };
		mocks.generate.mockRejectedValue(apiError(401, "Invalid API key"));
		await expect(
			askDefaultModel({
				userId: "user",
				task: "evidence",
				system: "s",
				prompt: "p",
				schema: aiTaskSettingsSchema as never,
			}),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		expect(mocks.generate).toHaveBeenCalledTimes(1);
	});
});
