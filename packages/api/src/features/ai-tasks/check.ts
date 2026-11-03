import type { ResolvedModel } from "./resolve";
import type { TaskModel } from "@reactive-resume/schema/ai-tasks";
import { generateText, jsonSchema, tool } from "ai";
import z from "zod";
import { generateJson } from "../ai/generate-json";

/**
 * Checks what a configured model can do for this app: answer with valid JSON (every resume step needs it), call a
 * tool (the coach and assistant need it), and accept the reasoning-effort setting when one is set.
 */
export async function checkCapabilities(
	resolved: ResolvedModel,
	setting: TaskModel,
): Promise<NonNullable<TaskModel["lastTest"]>> {
	const started = Date.now();
	const result: NonNullable<TaskModel["lastTest"]> = {
		at: new Date().toISOString(),
		model: resolved.label,
		ok: false,
		json: false,
		tools: false,
		reasoning: setting.reasoningEffort === "default" || !resolved.providerOptions ? "not-sent" : "rejected",
		latencyMs: 0,
		message: "",
	};
	const signal = AbortSignal.timeout(60_000);
	const askJson = (providerOptions: typeof resolved.providerOptions) =>
		generateJson(
			resolved.model,
			{ prompt: 'Return JSON exactly like {"answer": 4} where answer is 2 + 2.' },
			z.object({ answer: z.coerce.number() }),
			signal,
			{ providerOptions },
		);
	try {
		const answer = await askJson(resolved.providerOptions);
		result.json = answer.answer === 4;
		if (result.reasoning === "rejected") result.reasoning = "accepted";
	} catch (error) {
		result.message = `JSON: ${error instanceof Error ? error.message.slice(0, 200) : "failed"}`;
		// Without the reasoning effort, to tell a model that rejects the option from one that can't answer at all.
		if (result.reasoning === "rejected")
			try {
				const answer = await askJson(undefined);
				result.json = answer.answer === 4;
				result.message = "This model doesn't accept a reasoning effort. Set it to Provider default.";
			} catch {
				// Keep the first error.
			}
	}
	try {
		const answer = await generateText({
			model: resolved.model,
			maxRetries: 0,
			abortSignal: signal,
			prompt: "Call the record_number tool with the number 7.",
			toolChoice: "required",
			tools: {
				record_number: tool({
					description: "Records a number.",
					inputSchema: jsonSchema<{ value: number }>({
						type: "object",
						properties: { value: { type: "number" } },
						required: ["value"],
					}),
				}),
			},
			...(resolved.providerOptions ? { providerOptions: resolved.providerOptions } : {}),
		});
		result.tools = answer.toolCalls.length > 0;
	} catch (error) {
		result.message = [result.message, `Tools: ${error instanceof Error ? error.message.slice(0, 200) : "failed"}`]
			.filter(Boolean)
			.join(" ");
	}
	result.latencyMs = Date.now() - started;
	// Usable only as configured: a rejected reasoning effort would fail every real request too.
	result.ok = result.json && result.reasoning !== "rejected";
	if (!result.message)
		result.message = result.tools
			? "Answers with valid JSON and calls tools."
			: "Answers with valid JSON; tool calls didn't work, so use it for resume steps only.";
	return result;
}
