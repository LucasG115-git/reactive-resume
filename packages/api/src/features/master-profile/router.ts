import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as tables from "@reactive-resume/db/schema";
import {
	profileAchievementInputSchema,
	profileEntryInputSchema,
	profileEntryKindSchema,
	profileMetricSchema,
	profileReorderInputSchema,
	profileSkillInputSchema,
} from "@reactive-resume/schema/master-profile";
import { protectedProcedure } from "../../context";
import { masterProfileService } from "./service";

const tags = ["Master profile"];
const stringList = z.array(z.string());

export const profileEntrySchema = createSelectSchema(tables.profileEntry, {
	kind: profileEntryKindSchema,
	tags: stringList,
});
export const profileAchievementSchema = createSelectSchema(tables.profileAchievement, {
	metrics: z.array(profileMetricSchema),
	skills: stringList,
	tags: stringList,
	variants: stringList,
});
export const profileSkillSchema = createSelectSchema(tables.profileSkill, { aliases: stringList });
export const masterProfileSchema = z.object({
	entries: z.array(profileEntrySchema.extend({ achievements: z.array(profileAchievementSchema) })),
	standalone: z.array(profileAchievementSchema),
	skills: z.array(profileSkillSchema),
});

const id = z.object({ id: z.string().min(1) });
const optionalId = z.object({ id: z.string().min(1).optional() });

export const masterProfileRouter = {
	get: protectedProcedure
		.route({
			method: "GET",
			path: "/master-profile",
			tags,
			operationId: "getMasterProfile",
			summary: "Get the master profile",
			description: "Every entry with its achievements, standalone achievements, and skills.",
		})
		.input(z.object({}).optional())
		.output(masterProfileSchema)
		.handler(({ context }) => masterProfileService.get(context.user.id)),

	saveEntry: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/entries",
			tags,
			operationId: "saveMasterProfileEntry",
			summary: "Create or update a profile entry",
		})
		.input(z.intersection(profileEntryInputSchema, optionalId))
		.output(profileEntrySchema)
		.handler(({ context, input: { id: entryId, ...input } }) =>
			masterProfileService.saveEntry(context.user.id, input, entryId),
		),

	deleteEntry: protectedProcedure
		.route({
			method: "DELETE",
			path: "/master-profile/entries/{id}",
			tags,
			operationId: "deleteMasterProfileEntry",
			summary: "Delete a profile entry and its achievements",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => masterProfileService.deleteEntry(context.user.id, input.id)),

	saveAchievement: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/achievements",
			tags,
			operationId: "saveMasterProfileAchievement",
			summary: "Create or update an achievement",
		})
		.input(profileAchievementInputSchema.extend(optionalId.shape))
		.output(profileAchievementSchema)
		.handler(({ context, input: { id: achievementId, ...input } }) =>
			masterProfileService.saveAchievement(context.user.id, input, achievementId),
		),

	deleteAchievement: protectedProcedure
		.route({
			method: "DELETE",
			path: "/master-profile/achievements/{id}",
			tags,
			operationId: "deleteMasterProfileAchievement",
			summary: "Delete an achievement",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => masterProfileService.deleteAchievement(context.user.id, input.id)),

	saveSkill: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/skills",
			tags,
			operationId: "saveMasterProfileSkill",
			summary: "Create or update a skill",
		})
		.input(profileSkillInputSchema.extend(optionalId.shape))
		.output(profileSkillSchema)
		.errors({ CONFLICT: { message: "A skill with that name already exists.", status: 409 } })
		.handler(({ context, input: { id: skillId, ...input } }) =>
			masterProfileService.saveSkill(context.user.id, input, skillId),
		),

	deleteSkill: protectedProcedure
		.route({
			method: "DELETE",
			path: "/master-profile/skills/{id}",
			tags,
			operationId: "deleteMasterProfileSkill",
			summary: "Delete a skill",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => masterProfileService.deleteSkill(context.user.id, input.id)),

	reorder: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/reorder",
			tags,
			operationId: "reorderMasterProfile",
			summary: "Reorder entries, achievements or skills",
		})
		.input(profileReorderInputSchema)
		.output(z.void())
		.handler(({ context, input }) => masterProfileService.reorder(context.user.id, input)),
};
