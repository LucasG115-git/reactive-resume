import type { ResumeImport } from "./import";
import type {
	ProfileAchievementInput,
	ProfileEntryInput,
	ProfileReorderInput,
	ProfileSkillInput,
} from "@reactive-resume/schema/master-profile";
import type { ProfileFile } from "@reactive-resume/schema/master-profile";
import { ORPCError } from "@orpc/client";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { lockUser } from "../documents/ownership";
import { resumeService } from "../resume/service";
import { profileFileToRecords, resumeToProfile } from "./import";

type Entry = typeof tables.profileEntry.$inferSelect;
type Achievement = typeof tables.profileAchievement.$inferSelect;
type Skill = typeof tables.profileSkill.$inferSelect;

export type MasterProfile = {
	entries: Array<Entry & { achievements: Achievement[] }>;
	/** Achievements not attached to any entry. */
	standalone: Achievement[];
	skills: Skill[];
};

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
	let current: unknown = error;
	// Drizzle wraps driver errors; walk the cause chain for the PostgreSQL code.
	for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
		if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

/** Next sort position at the end of a user's list, so new rows appear last. */
async function nextSortOrder(
	table: typeof tables.profileEntry | typeof tables.profileAchievement | typeof tables.profileSkill,
	userId: string,
) {
	const [row] = await db
		.select({ max: sql<number | null>`max(${table.sortOrder})` })
		.from(table)
		.where(eq(table.userId, userId));
	return (row?.max ?? -1) + 1;
}

async function requireEntry(userId: string, entryId: string | null) {
	if (!entryId) return;
	const [entry] = await db
		.select({ id: tables.profileEntry.id })
		.from(tables.profileEntry)
		.where(and(eq(tables.profileEntry.id, entryId), eq(tables.profileEntry.userId, userId)));
	if (!entry) throw new ORPCError("NOT_FOUND", { message: "That profile entry doesn't exist." });
}

function notFound(): never {
	throw new ORPCError("NOT_FOUND");
}

/** Newest first for ongoing roles, then by end date, then by start date; manual order breaks ties. */
export function compareEntries(a: Entry, b: Entry): number {
	if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
	const end = (entry: Entry) => entry.endDate ?? (entry.startDate ? "9999" : "");
	return end(b).localeCompare(end(a)) || (b.startDate ?? "").localeCompare(a.startDate ?? "");
}

export const masterProfileService = {
	get: async (userId: string): Promise<MasterProfile> => {
		const [entries, achievements, skills] = await Promise.all([
			db.select().from(tables.profileEntry).where(eq(tables.profileEntry.userId, userId)),
			db
				.select()
				.from(tables.profileAchievement)
				.where(eq(tables.profileAchievement.userId, userId))
				.orderBy(asc(tables.profileAchievement.sortOrder), asc(tables.profileAchievement.createdAt)),
			db
				.select()
				.from(tables.profileSkill)
				.where(eq(tables.profileSkill.userId, userId))
				.orderBy(asc(tables.profileSkill.category), asc(tables.profileSkill.sortOrder), asc(tables.profileSkill.name)),
		]);

		const byEntry = new Map<string, Achievement[]>();
		const standalone: Achievement[] = [];
		for (const achievement of achievements) {
			if (!achievement.entryId) {
				standalone.push(achievement);
				continue;
			}
			const list = byEntry.get(achievement.entryId) ?? [];
			list.push(achievement);
			byEntry.set(achievement.entryId, list);
		}

		return {
			entries: entries
				.toSorted(compareEntries)
				.map((entry) => ({ ...entry, achievements: byEntry.get(entry.id) ?? [] })),
			standalone,
			skills,
		};
	},

	saveEntry: async (userId: string, input: ProfileEntryInput, id?: string): Promise<Entry> => {
		if (id) {
			const [row] = await db
				.update(tables.profileEntry)
				.set(input)
				.where(and(eq(tables.profileEntry.id, id), eq(tables.profileEntry.userId, userId)))
				.returning();
			return row ?? notFound();
		}
		const sortOrder = await nextSortOrder(tables.profileEntry, userId);
		const [row] = await db
			.insert(tables.profileEntry)
			.values({ userId, sortOrder, ...input })
			.returning();
		return row ?? notFound();
	},

	deleteEntry: async (userId: string, id: string) => {
		// Achievements cascade with their entry.
		await db
			.delete(tables.profileEntry)
			.where(and(eq(tables.profileEntry.id, id), eq(tables.profileEntry.userId, userId)));
	},

	saveAchievement: async (userId: string, input: ProfileAchievementInput, id?: string): Promise<Achievement> => {
		await requireEntry(userId, input.entryId);
		if (id) {
			const [row] = await db
				.update(tables.profileAchievement)
				.set(input)
				.where(and(eq(tables.profileAchievement.id, id), eq(tables.profileAchievement.userId, userId)))
				.returning();
			return row ?? notFound();
		}
		const sortOrder = await nextSortOrder(tables.profileAchievement, userId);
		const [row] = await db
			.insert(tables.profileAchievement)
			.values({ userId, sortOrder, ...input })
			.returning();
		return row ?? notFound();
	},

	deleteAchievement: async (userId: string, id: string) => {
		await db
			.delete(tables.profileAchievement)
			.where(and(eq(tables.profileAchievement.id, id), eq(tables.profileAchievement.userId, userId)));
	},

	saveSkill: async (userId: string, input: ProfileSkillInput, id?: string): Promise<Skill> => {
		try {
			if (id) {
				const [row] = await db
					.update(tables.profileSkill)
					.set(input)
					.where(and(eq(tables.profileSkill.id, id), eq(tables.profileSkill.userId, userId)))
					.returning();
				return row ?? notFound();
			}
			const sortOrder = await nextSortOrder(tables.profileSkill, userId);
			const [row] = await db
				.insert(tables.profileSkill)
				.values({ userId, sortOrder, ...input })
				.returning();
			return row ?? notFound();
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ORPCError("CONFLICT", { message: `You already have a skill named "${input.name}".` });
			}
			throw error;
		}
	},

	deleteSkill: async (userId: string, id: string) => {
		await db
			.delete(tables.profileSkill)
			.where(and(eq(tables.profileSkill.id, id), eq(tables.profileSkill.userId, userId)));
	},

	reorder: async (userId: string, input: ProfileReorderInput) => {
		const table = {
			entry: tables.profileEntry,
			achievement: tables.profileAchievement,
			skill: tables.profileSkill,
		}[input.table];
		const ids = [...new Set(input.ids)];
		await db.transaction(async (tx) => {
			const owned = await tx
				.select({ id: table.id })
				.from(table)
				.where(and(eq(table.userId, userId), inArray(table.id, ids)));
			if (owned.length !== ids.length) throw new ORPCError("NOT_FOUND", { message: "Some items no longer exist." });
			for (const [index, rowId] of ids.entries()) {
				await tx
					.update(table)
					.set({ sortOrder: index })
					.where(and(eq(table.id, rowId), eq(table.userId, userId)));
			}
		});
	},

	/**
	 * Adds a resume's experience, projects, education, volunteering, certifications, awards and skills to the
	 * profile. Entries already present (same type, title, organization and start) only gain bullets they don't
	 * have; skills already present are skipped. Safe to run again.
	 */
	importFromResume: async (userId: string, resumeId: string) => {
		const resume = await resumeService.getById({ id: resumeId, userId });
		return (await importRecords(userId, resumeToProfile(resume.data), false)).counts;
	},

	/** Adds a profile file's records, or with `dryRun` only reports what would be added. */
	importFile: (userId: string, file: ProfileFile, dryRun: boolean) =>
		importRecords(userId, profileFileToRecords(file), dryRun),
};

export type ImportPreview = {
	counts: { entries: number; achievements: number; skills: number };
	/** Every entry in the import, whether it's new, and the achievements it would gain. */
	entries: Array<{ kind: string; title: string; organization: string; isNew: boolean; achievements: string[] }>;
	/** Skill names that would be added. */
	skills: string[];
	/** Skill names already in the profile, left as they are. */
	existingSkills: string[];
};

const entryKey = (entry: { kind: string; title: string; organization: string; startDate: string | null }) =>
	[entry.kind, entry.title, entry.organization, entry.startDate ?? ""].join("\u0000").toLocaleLowerCase();
const textKey = (entryId: string, text: string) => `${entryId}\u0000${text.trim().toLocaleLowerCase()}`;

/**
 * Adds imported records to a profile, skipping what's already there: an entry with the same type, title,
 * organization and start only gains achievements it doesn't have, and existing skills are left alone.
 * Plans first, then writes everything in one transaction, so a preview and the real run agree.
 */
function importRecords(userId: string, imported: ResumeImport, dryRun: boolean): Promise<ImportPreview> {
	return db.transaction(async (tx) => {
		await lockUser(tx, userId);
		const existing = await tx.select().from(tables.profileEntry).where(eq(tables.profileEntry.userId, userId));
		const byKey = new Map(existing.map((entry) => [entryKey(entry), entry.id]));
		const texts = new Set(
			(
				await tx
					.select({ entryId: tables.profileAchievement.entryId, text: tables.profileAchievement.text })
					.from(tables.profileAchievement)
					.where(eq(tables.profileAchievement.userId, userId))
			).map((row) => textKey(row.entryId ?? "", row.text)),
		);
		const skillNames = new Set(
			(
				await tx
					.select({ name: tables.profileSkill.name })
					.from(tables.profileSkill)
					.where(eq(tables.profileSkill.userId, userId))
			).map((row) => row.name.toLocaleLowerCase()),
		);

		// Plan: entries keyed so repeats inside one import merge too.
		type Planned = {
			entry: (typeof imported.entries)[number]["entry"];
			existingId: string | null;
			achievements: (typeof imported.entries)[number]["achievements"];
		};
		const planned = new Map<string, Planned>();
		for (const { entry, achievements } of imported.entries) {
			const key = entryKey(entry);
			const plan = planned.get(key) ?? { entry, existingId: byKey.get(key) ?? null, achievements: [] };
			const scope = plan.existingId ?? `new:${key}`;
			for (const achievement of achievements) {
				const keyText = textKey(scope, achievement.text);
				if (texts.has(keyText)) continue;
				texts.add(keyText);
				plan.achievements.push(achievement);
			}
			planned.set(key, plan);
		}
		const skills = imported.skills.filter((skill) => {
			const name = skill.name.toLocaleLowerCase();
			if (skillNames.has(name)) return false;
			skillNames.add(name);
			return true;
		});

		const preview: ImportPreview = {
			counts: {
				entries: [...planned.values()].filter((plan) => !plan.existingId).length,
				achievements: [...planned.values()].reduce((sum, plan) => sum + plan.achievements.length, 0),
				skills: skills.length,
			},
			entries: [...planned.values()].map((plan) => ({
				kind: plan.entry.kind,
				title: plan.entry.title,
				organization: plan.entry.organization,
				isNew: !plan.existingId,
				achievements: plan.achievements.map((achievement) => achievement.text),
			})),
			skills: skills.map((skill) => skill.name),
			existingSkills: imported.skills
				.map((skill) => skill.name)
				.filter((name) => !skills.some((skill) => skill.name === name)),
		};
		if (dryRun) return preview;

		const [order] = await tx
			.select({ entry: sql<number | null>`max(${tables.profileEntry.sortOrder})` })
			.from(tables.profileEntry)
			.where(eq(tables.profileEntry.userId, userId));
		let entryOrder = (order?.entry ?? -1) + 1;
		for (const plan of planned.values()) {
			let entryId = plan.existingId;
			if (!entryId) {
				const [row] = await tx
					.insert(tables.profileEntry)
					.values({ userId, sortOrder: entryOrder++, ...plan.entry })
					.returning({ id: tables.profileEntry.id });
				if (!row) continue;
				entryId = row.id;
			}
			if (plan.achievements.length > 0)
				await tx
					.insert(tables.profileAchievement)
					.values(
						plan.achievements.map((achievement, index) => ({ userId, entryId, sortOrder: index, ...achievement })),
					);
		}
		if (skills.length > 0)
			await tx
				.insert(tables.profileSkill)
				.values(skills.map((skill, index) => ({ userId, sortOrder: index, ...skill })))
				.onConflictDoNothing();
		return preview;
	});
}
