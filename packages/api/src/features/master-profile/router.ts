import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as tables from "@reactive-resume/db/schema";
import {
	assembleInputSchema,
	profileAchievementInputSchema,
	profileAssemblyResultSchema,
	profileEntryInputSchema,
	profileEntryKindSchema,
	profileMetricSchema,
	profileReorderInputSchema,
	profileSkillInputSchema,
} from "@reactive-resume/schema/master-profile";
import { protectedProcedure } from "../../context";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { assembleService } from "./assemble/service";
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

const assemblySchema = createSelectSchema(tables.profileAssembly, {
	mode: z.enum(["rephrase", "verbatim"]),
	result: profileAssemblyResultSchema,
});

export const masterProfileRouter = {
	assemble: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/assemble",
			tags,
			operationId: "assembleResumeFromProfile",
			summary: "Assemble a tailored resume for an application",
			description:
				"Chooses the master-profile achievements and skills that best match the application's posting, builds a resume from them on top of a base resume's details and design, links it to the application, and records which profile item each line came from. Uses the default AI connection.",
		})
		.use(aiRequestRateLimit)
		.input(assembleInputSchema)
		.output(z.object({ assemblyId: z.string(), resumeId: z.string(), result: profileAssemblyResultSchema }))
		.errors({
			BAD_GATEWAY: { message: "The AI provider returned an error or couldn't be reached.", status: 502 },
		})
		.handler(({ context, input, signal }) => assembleService.assemble(context.user.id, input, { signal })),

	latestAssembly: protectedProcedure
		.route({
			method: "GET",
			path: "/master-profile/assemblies/latest",
			tags,
			operationId: "getLatestProfileAssembly",
			summary: "Get the latest assembly for an application",
		})
		.input(z.object({ applicationId: z.string().min(1) }))
		.output(assemblySchema.nullable())
		.handler(({ context, input }) => assembleService.latest(context.user.id, input.applicationId)),

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

	importFromResume: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/import-resume",
			tags,
			operationId: "importMasterProfileFromResume",
			summary: "Add a resume's history to the master profile",
			description:
				"Copies a resume's experience, projects, education, volunteering, certifications, awards and skills into the master profile, skipping anything already there. Uses no AI.",
		})
		.input(z.object({ resumeId: z.string().min(1) }))
		.output(z.object({ entries: z.number(), achievements: z.number(), skills: z.number() }))
		.handler(({ context, input }) => masterProfileService.importFromResume(context.user.id, input.resumeId)),

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
