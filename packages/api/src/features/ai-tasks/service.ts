import type { AiTask, AiTaskSettings } from "@reactive-resume/schema/ai-tasks";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { aiTaskSettingsSchema } from "@reactive-resume/schema/ai-tasks";
import { checkCapabilities } from "./check";
import { resolveSetting, taskSettings } from "./resolve";

async function write(userId: string, settings: AiTaskSettings) {
	await db
		.insert(tables.aiTaskSettings)
		.values({ userId, data: settings })
		.onConflictDoUpdate({ target: tables.aiTaskSettings.userId, set: { data: settings, updatedAt: new Date() } });
	return settings;
}

const same = (a: AiTaskSettings["thorough"], b: AiTaskSettings["thorough"]) =>
	a.providerId === b.providerId && a.model === b.model && a.reasoningEffort === b.reasoningEffort;

export const aiTasksService = {
	get: taskSettings,

	/** Saves settings; a check result is kept only while the setting it checked is unchanged. */
	save: async (userId: string, input: AiTaskSettings) => {
		const stored = await taskSettings(userId);
		const next = aiTaskSettingsSchema.parse(input);
		for (const task of Object.keys(next.tasks) as AiTask[])
			next.tasks[task].lastTest = same(next.tasks[task], stored.tasks[task]) ? stored.tasks[task].lastTest : null;
		next.thorough.lastTest = same(next.thorough, stored.thorough) ? stored.thorough.lastTest : null;
		return write(userId, next);
	},

	/** Runs the capability check for one task's saved setting (or the Thorough one) and keeps the result. */
	check: async (userId: string, target: AiTask | "thorough") => {
		const settings = await taskSettings(userId);
		const setting = target === "thorough" ? settings.thorough : settings.tasks[target];
		const result = await checkCapabilities(await resolveSetting(userId, setting), setting);
		setting.lastTest = result;
		await write(userId, settings);
		return settings;
	},
};
