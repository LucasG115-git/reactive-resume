import type {
	ProfileAchievementInput,
	ProfileEntryInput,
	ProfileReorderInput,
	ProfileSkillInput,
} from "@reactive-resume/schema/master-profile";
import { ORPCError } from "@orpc/client";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";

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
};
