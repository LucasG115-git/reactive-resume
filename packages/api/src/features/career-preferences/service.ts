import type { Posting } from "./evaluate";
import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { careerProfileDataSchema } from "@reactive-resume/schema/career";
import { evaluatePreferences } from "./evaluate";

/** The keys the user set aside, per application. */
export async function overridesFor(userId: string, applicationIds?: string[]) {
	const rows = await db
		.select({ applicationId: tables.careerPreferenceOverride.applicationId, key: tables.careerPreferenceOverride.key })
		.from(tables.careerPreferenceOverride)
		.where(eq(tables.careerPreferenceOverride.userId, userId));
	const byApplication = new Map<string, Set<string>>();
	for (const row of rows) {
		if (applicationIds && !applicationIds.includes(row.applicationId)) continue;
		byApplication.set(row.applicationId, (byApplication.get(row.applicationId) ?? new Set()).add(row.key));
	}
	return byApplication;
}

export async function profileFor(userId: string) {
	const [row] = await db
		.select({ data: tables.careerProfile.data })
		.from(tables.careerProfile)
		.where(eq(tables.careerProfile.userId, userId));
	return careerProfileDataSchema.parse(row?.data ?? {});
}

export const applicationPosting = (application: {
	role: string;
	location: string | null;
	jobDescription: string | null;
	salary?: string | null;
}): Posting => ({
	role: application.role,
	location: application.location ?? "",
	// A salary typed into the application counts as part of the posting.
	text: [application.salary ? `Salary: ${application.salary}` : "", application.jobDescription ?? ""]
		.filter(Boolean)
		.join("\n"),
});

async function ownedApplication(userId: string, applicationId: string) {
	const [application] = await db
		.select({
			id: tables.application.id,
			role: tables.application.role,
			location: tables.application.location,
			salary: tables.application.salary,
			jobDescription: tables.application.jobDescription,
		})
		.from(tables.application)
		.where(and(eq(tables.application.id, applicationId), eq(tables.application.userId, userId)));
	if (!application) throw new ORPCError("NOT_FOUND");
	return application;
}

export const careerPreferencesService = {
	evaluateApplication: async (userId: string, applicationId: string) => {
		const [application, profile, overrides] = await Promise.all([
			ownedApplication(userId, applicationId),
			profileFor(userId),
			overridesFor(userId, [applicationId]),
		]);
		return evaluatePreferences(profile, applicationPosting(application), overrides.get(applicationId));
	},

	setOverride: async (
		userId: string,
		input: { applicationId: string; key: string; overridden: boolean; note?: string | undefined },
	) => {
		await ownedApplication(userId, input.applicationId);
		if (input.overridden)
			await db
				.insert(tables.careerPreferenceOverride)
				.values({ userId, applicationId: input.applicationId, key: input.key, note: input.note ?? "" })
				.onConflictDoUpdate({
					target: [
						tables.careerPreferenceOverride.userId,
						tables.careerPreferenceOverride.applicationId,
						tables.careerPreferenceOverride.key,
					],
					set: { note: input.note ?? "" },
				});
		else
			await db
				.delete(tables.careerPreferenceOverride)
				.where(
					and(
						eq(tables.careerPreferenceOverride.userId, userId),
						eq(tables.careerPreferenceOverride.applicationId, input.applicationId),
						eq(tables.careerPreferenceOverride.key, input.key),
					),
				);
		return careerPreferencesService.evaluateApplication(userId, input.applicationId);
	},
};
