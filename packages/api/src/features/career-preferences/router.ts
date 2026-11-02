import z from "zod";
import { preferenceEvaluationSchema } from "@reactive-resume/schema/career-preferences";
import { protectedProcedure } from "../../context";
import { careerPreferencesService } from "./service";

const tags = ["Career"];

export const careerPreferencesRouter = {
	evaluateApplication: protectedProcedure
		.route({
			method: "GET",
			path: "/career/applications/{applicationId}/preferences",
			tags,
			operationId: "evaluateApplicationPreferences",
			summary: "Check an application against Preferences",
			description:
				"Each preference as met, unmet, unknown or set aside for this application, with a reason, and an overall verdict: fits, check (a must-have is unconfirmed) or conflict (a must-have is confirmed unmet). No AI is used.",
		})
		.input(z.object({ applicationId: z.string().min(1) }))
		.output(preferenceEvaluationSchema)
		.handler(({ context, input }) =>
			careerPreferencesService.evaluateApplication(context.user.id, input.applicationId),
		),

	setOverride: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/applications/{applicationId}/preferences/{key}",
			tags,
			operationId: "setApplicationPreferenceOverride",
			summary: "Set a preference aside for one application",
			description: "Marks one preference (by its check key) as not mattering for this application, or restores it.",
		})
		.input(
			z.object({
				applicationId: z.string().min(1),
				key: z.string().min(1).max(200),
				overridden: z.boolean(),
				note: z.string().trim().max(500).optional(),
			}),
		)
		.output(preferenceEvaluationSchema)
		.handler(({ context, input }) => careerPreferencesService.setOverride(context.user.id, input)),
};
