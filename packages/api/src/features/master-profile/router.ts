import { ORPCError } from "@orpc/client";
import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as tables from "@reactive-resume/db/schema";
import {
	assembleInputSchema,
	profileAchievementInputSchema,
	profileAssemblyResultSchema,
	profileEntryInputSchema,
	profileEntryKindSchema,
	profileFileSchema,
	profileMetricSchema,
	profileReorderInputSchema,
	profileSkillInputSchema,
	storyFileSchema,
} from "@reactive-resume/schema/master-profile";
import {
	jobAnalysisSchema,
	resumeSelectionPlanSchema,
	selectionEditSchema,
} from "@reactive-resume/schema/resume-selection";
import { protectedProcedure } from "../../context";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { assembleService } from "./assemble/service";
import { ProfileFileError } from "./import";
import { selectionService } from "./selection/service";
import { masterProfileService } from "./service";
import { factCatalog, importStories } from "./stories";

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

const selectionSchema = z
	.object({
		analysis: jobAnalysisSchema,
		plan: resumeSelectionPlanSchema,
		proposed: resumeSelectionPlanSchema,
		postingText: z.string(),
		model: z.string(),
		updatedAt: z.date(),
		postingChanged: z.boolean(),
		profileChanged: z.boolean(),
	})
	.nullable();
const applicationInput = z.object({ applicationId: z.string().min(1) });

export const masterProfileRouter = {
	selection: {
		get: protectedProcedure
			.route({
				method: "GET",
				path: "/master-profile/selections/{applicationId}",
				tags,
				operationId: "getResumeSelection",
				summary: "Get an application's Resume Selection Plan",
				description:
					"The posting's job analysis (ranked requirements), the proposed plan and the user's reviewed plan, with flags when the posting or profile changed since. Null before a plan is proposed.",
			})
			.input(applicationInput)
			.output(selectionSchema)
			.handler(({ context, input }) => selectionService.get(context.user.id, input.applicationId)),

		propose: protectedProcedure
			.route({
				method: "POST",
				path: "/master-profile/selections/{applicationId}/proposals",
				tags,
				operationId: "proposeResumeSelection",
				summary: "Analyse the posting and propose which profile records to use",
				description:
					"Analyses the application's posting into ranked requirements (reused while the posting is unchanged unless reanalyze is set), ranks every eligible master-profile record against them, has the default AI connection review the strongest, and saves a Resume Selection Plan. The user's earlier include/exclude choices carry over. The profile is never changed.",
			})
			.use(aiRequestRateLimit)
			.input(applicationInput.extend({ reanalyze: z.boolean().optional() }))
			.output(selectionSchema)
			.errors({ BAD_GATEWAY: { message: "The AI provider returned an error or couldn't be reached.", status: 502 } })
			.handler(({ context, input, signal }) => selectionService.propose(context.user.id, input, { signal })),

		update: protectedProcedure
			.route({
				method: "PUT",
				path: "/master-profile/selections/{applicationId}",
				tags,
				operationId: "updateResumeSelection",
				summary: "Save the user's review of a Resume Selection Plan",
				description:
					"Sets which entries, achievements and skills are included and the order of achievements within each entry. Coverage is recomputed; profile records are never changed.",
			})
			.input(selectionEditSchema)
			.output(selectionSchema)
			.handler(({ context, input }) => selectionService.update(context.user.id, input)),

		reset: protectedProcedure
			.route({
				method: "POST",
				path: "/master-profile/selections/{applicationId}/reset",
				tags,
				operationId: "resetResumeSelection",
				summary: "Discard edits and return to the proposed plan",
			})
			.input(applicationInput)
			.output(selectionSchema)
			.handler(({ context, input }) => selectionService.reset(context.user.id, input.applicationId)),
	},

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

	factCatalog: protectedProcedure
		.route({
			method: "GET",
			path: "/master-profile/fact-catalog",
			tags,
			operationId: "getMasterProfileFactCatalog",
			summary: "List citable facts with short ids",
			description:
				"Every switched-on fact shared across applications, with a short id (F-xxxxxxxx) that a story file can cite.",
		})
		.input(z.object({}).optional())
		.output(z.array(z.object({ ref: z.string(), category: z.string(), text: z.string() })))
		.handler(({ context }) => factCatalog(context.user.id)),

	importStories: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/import-stories",
			tags,
			operationId: "importCareerStoriesFile",
			summary: "Preview or import a story file",
			description:
				"Adds STARR stories from a story file, linking each to the facts it cites by short id. Stories whose title already exists are skipped. With dryRun, nothing is saved.",
		})
		.input(z.object({ file: storyFileSchema, dryRun: z.boolean().default(true) }))
		.output(
			z.object({
				stories: z.array(z.object({ title: z.string(), isNew: z.boolean(), facts: z.array(z.string()) })),
				added: z.number(),
				skipped: z.array(z.string()),
			}),
		)
		.errors({ BAD_REQUEST: { message: "The story file has problems.", status: 400 } })
		.handler(async ({ context, input }) => {
			try {
				return await importStories(context.user.id, input.file, input.dryRun);
			} catch (error) {
				if (error instanceof ProfileFileError)
					throw new ORPCError("BAD_REQUEST", {
						message: `The story file has problems:\n${error.problems.join("\n")}`,
						data: { problems: error.problems },
					});
				throw error;
			}
		}),

	syncKnowledge: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/sync-knowledge",
			tags,
			operationId: "syncMasterProfileKnowledge",
			summary: "Sync the master profile to Career Knowledge facts",
			description:
				"Adds, updates or switches off the facts made from the master profile so Fit, Apply, Prepare and the coach can use it. Facts corrected, switched off or forgotten in Knowledge are left as they are. With dryRun, nothing changes and the counts say what would.",
		})
		.input(z.object({ dryRun: z.boolean().default(true) }))
		.output(
			z.object({
				added: z.number(),
				updated: z.number(),
				switchedOff: z.number(),
				keptCorrections: z.number(),
				keptOff: z.number(),
				unchanged: z.number(),
			}),
		)
		.handler(({ context, input }) => masterProfileService.syncKnowledge(context.user.id, input.dryRun)),

	importFile: protectedProcedure
		.route({
			method: "POST",
			path: "/master-profile/import-file",
			tags,
			operationId: "importMasterProfileFile",
			summary: "Preview or import a profile file",
			description:
				"Adds the entries, achievements and skills in a profile file (the JSON form of the YAML profile format) to the master profile, skipping anything already there. With dryRun, nothing is saved and the response lists what would be added.",
		})
		.input(z.object({ file: profileFileSchema, dryRun: z.boolean().default(true) }))
		.output(
			z.object({
				counts: z.object({ entries: z.number(), achievements: z.number(), skills: z.number() }),
				entries: z.array(
					z.object({
						kind: z.string(),
						title: z.string(),
						organization: z.string(),
						isNew: z.boolean(),
						achievements: z.array(z.string()),
					}),
				),
				skills: z.array(z.string()),
				existingSkills: z.array(z.string()),
			}),
		)
		.errors({ BAD_REQUEST: { message: "The profile file has problems.", status: 400 } })
		.handler(async ({ context, input }) => {
			try {
				return await masterProfileService.importFile(context.user.id, input.file, input.dryRun);
			} catch (error) {
				if (error instanceof ProfileFileError)
					throw new ORPCError("BAD_REQUEST", {
						message: `The profile file has problems:\n${error.problems.join("\n")}`,
						data: { problems: error.problems },
					});
				throw error;
			}
		}),

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
