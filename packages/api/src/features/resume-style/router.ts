import z from "zod";
import { resumeStyleGuideSchema, styleExampleSchema } from "@reactive-resume/schema/resume-style";
import { protectedProcedure } from "../../context";
import { storageUploadRateLimit } from "../../middleware/rate-limit";
import { resumeStyleService } from "./service";

const tags = ["Resume style"];

export const resumeStyleRouter = {
	get: protectedProcedure
		.route({
			method: "GET",
			path: "/resume-style",
			tags,
			operationId: "getResumeStyleGuide",
			summary: "Get the Resume Style Guide",
			description: "Writing presets for different career directions and example resumes. Defaults when none is saved.",
		})
		.input(z.object({}).optional())
		.output(resumeStyleGuideSchema)
		.handler(({ context }) => resumeStyleService.get(context.user.id)),

	save: protectedProcedure
		.route({
			method: "PUT",
			path: "/resume-style",
			tags,
			operationId: "saveResumeStyleGuide",
			summary: "Save the Resume Style Guide",
			description:
				"Replaces presets and settings. Examples can be renamed, annotated or removed here; add them with the example endpoints.",
		})
		.input(resumeStyleGuideSchema)
		.output(resumeStyleGuideSchema)
		.handler(({ context, input }) => resumeStyleService.save(context.user.id, input)),

	addExampleFromResume: protectedProcedure
		.route({
			method: "POST",
			path: "/resume-style/examples/from-resume",
			tags,
			operationId: "addResumeStyleExampleFromResume",
			summary: "Add one of your resumes as a style example",
		})
		.input(
			z.object({
				resumeId: z.string().min(1),
				title: z.string().max(120).optional(),
				notes: z.string().max(500).optional(),
			}),
		)
		.output(styleExampleSchema)
		.handler(({ context, input }) => resumeStyleService.addExampleFromResume(context.user.id, input)),

	addExampleFromFile: protectedProcedure
		.route({
			method: "POST",
			path: "/resume-style/examples/from-file",
			tags,
			operationId: "addResumeStyleExampleFromFile",
			summary: "Upload a resume you like as a style example",
			description:
				"Multipart form with a file field: a PDF with a text layer, a Word (.docx) or a text file, up to 10 MB. Only the text is kept.",
		})
		.use(storageUploadRateLimit)
		.input(z.object({ file: z.file().max(10 * 1024 * 1024), notes: z.string().max(500).optional() }))
		.output(styleExampleSchema)
		.handler(({ context, input, signal }) => resumeStyleService.addExampleFromFile(context.user.id, input, signal)),
};
