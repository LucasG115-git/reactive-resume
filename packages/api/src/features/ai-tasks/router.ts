import z from "zod";
import { aiTaskSchema, aiTaskSettingsSchema } from "@reactive-resume/schema/ai-tasks";
import { protectedProcedure } from "../../context";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { aiTasksService } from "./service";

const tags = ["AI Providers"];

export const aiTasksRouter = {
	get: protectedProcedure
		.route({
			method: "GET",
			path: "/ai-tasks",
			tags,
			operationId: "getAiTaskSettings",
			summary: "Get the model used for each AI task",
			description:
				"Per-task connection and model, reasoning effort, the Thorough model and the default quality mode. Unset values use the default connection.",
		})
		.input(z.object({}).optional())
		.output(aiTaskSettingsSchema)
		.handler(({ context }) => aiTasksService.get(context.user.id)),

	save: protectedProcedure
		.route({
			method: "PUT",
			path: "/ai-tasks",
			tags,
			operationId: "saveAiTaskSettings",
			summary: "Save the model used for each AI task",
		})
		.input(aiTaskSettingsSchema)
		.output(aiTaskSettingsSchema)
		.handler(({ context, input }) => aiTasksService.save(context.user.id, input)),

	check: protectedProcedure
		.route({
			method: "POST",
			path: "/ai-tasks/{task}/check",
			tags,
			operationId: "checkAiTaskModel",
			summary: "Check a task's model",
			description:
				"Sends two tiny requests to the configured model: one for valid JSON (with the reasoning-effort setting, if any) and one tool call. Saves and returns the result.",
		})
		.use(aiRequestRateLimit)
		.input(z.object({ task: z.union([aiTaskSchema, z.literal("thorough")]) }))
		.output(aiTaskSettingsSchema)
		.handler(({ context, input }) => aiTasksService.check(context.user.id, input.task)),
};
