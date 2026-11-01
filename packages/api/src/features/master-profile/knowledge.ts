import type { MasterProfile } from "./service";
import type { FactCategory } from "@reactive-resume/schema/career";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { invalidateMemory } from "../career/service";
import { lockUser } from "../documents/ownership";

/**
 * Keeps Career Knowledge facts in step with the master profile, so Fit, Apply, Prepare and the coach can use it.
 *
 * Each visible profile record becomes one shared fact whose source is `{ kind: "profile", id, quote }`, where
 * `quote` is the text the sync last wrote. That makes the rules simple and safe:
 * - New records add facts. Records whose text changed update their fact, keeping the old text in its history
 *   (so stories built on it are flagged for review), unless the user corrected the fact in Knowledge
 *   (its text no longer matches `quote`): then the user's correction stands.
 * - Records that are hidden or gone switch their fact off. A fact the user switched off stays off, and a
 *   forgotten fact is never recreated.
 */

type Entry = MasterProfile["entries"][number];
type Achievement = Entry["achievements"][number];

export type DesiredFact = { sourceId: string; text: string; category: FactCategory };

const KIND_LABEL: Record<Entry["kind"], string> = {
	position: "Role",
	project: "Project",
	education: "Education",
	volunteer: "Volunteer role",
	certification: "Certification",
	award: "Award",
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function period(entry: Pick<Entry, "kind" | "startDate" | "endDate">) {
	if (entry.kind === "certification" || entry.kind === "award") return entry.startDate ?? entry.endDate ?? "";
	if (!entry.startDate) return entry.endDate ?? "";
	return `${entry.startDate}–${entry.endDate ?? "present"}`;
}

/** "Founder, Countdown Creative, 2020-06–present", without repeating an organization the title already names. */
export function entryLabel(entry: Entry) {
	const organization =
		entry.organization && !entry.title.toLocaleLowerCase().includes(entry.organization.toLocaleLowerCase())
			? entry.organization
			: "";
	return [entry.title, organization, period(entry)].filter(Boolean).join(", ");
}

const isRecent = (entry: Entry, now: Date) =>
	!entry.endDate || now.getFullYear() - Number(entry.endDate.slice(0, 4)) <= 5;

/**
 * Facts for a profile, most useful first. Generation fits facts into a budget, so order matters: skills,
 * always-include and measured achievements, recent work, then everything else, with course certificates last.
 */
export function profileFacts(profile: MasterProfile, now = new Date()): DesiredFact[] {
	const ranked: Array<DesiredFact & { rank: number }> = [];
	const visibleEntries = profile.entries.filter((entry) => !entry.hidden);

	for (const entry of visibleEntries) {
		const achievements = entry.achievements.filter((achievement) => !achievement.hidden);
		const label = entryLabel(entry);
		// The role itself: needed for "N years of …" and "experience with …" requirements.
		const scope = achievements.length === 0 && entry.summary ? ` ${clip(entry.summary, 300)}` : "";
		ranked.push({
			sourceId: `entry:${entry.id}`,
			category: "experience",
			text: clip(`${KIND_LABEL[entry.kind]}: ${label}.${scope}`, 600),
			rank: entry.kind === "certification" ? 6 : isRecent(entry, now) ? 3 : 4,
		});
		for (const achievement of achievements)
			ranked.push({
				sourceId: `achievement:${achievement.id}`,
				category: "accomplishment",
				text: clip(`${achievement.text.replace(/\.$/, "")} (${label}).`, 1200),
				rank: achievementRank(achievement, entry, now),
			});
	}

	for (const achievement of profile.standalone)
		if (!achievement.hidden)
			ranked.push({
				sourceId: `achievement:${achievement.id}`,
				category: "accomplishment",
				text: clip(achievement.text, 1200),
				rank: achievementRank(achievement, null, now),
			});

	// Skills: one fact per category, so a posting's tool list matches without a fact per tool.
	const categories = new Map<string, string[]>();
	for (const skill of profile.skills)
		if (!skill.hidden) {
			const category = skill.category.trim() || "Skills";
			categories.set(category, [...(categories.get(category) ?? []), skill.name]);
		}
	for (const [category, names] of categories)
		ranked.push({
			sourceId: `skills:${category.toLocaleLowerCase()}`,
			category: "skill",
			text: clip(`Skills — ${category}: ${names.join(", ")}.`, 2000),
			rank: 0,
		});

	return ranked.toSorted((a, b) => a.rank - b.rank).map(({ rank: _rank, ...fact }) => fact);
}

function achievementRank(achievement: Achievement, entry: Entry | null, now: Date) {
	if (achievement.core) return 1;
	const recent = entry ? isRecent(entry, now) : false;
	if (achievement.metrics.length > 0) return recent ? 1 : 2;
	return recent ? 2 : 5;
}

export type KnowledgeSyncResult = {
	added: number;
	updated: number;
	switchedOff: number;
	/** Facts left as they are because the user corrected them in Knowledge. */
	keptCorrections: number;
	/** Facts the user switched off or forgot, left that way. */
	keptOff: number;
	unchanged: number;
};

const sourceKeyOf = (sourceId: string, text: string) =>
	createHash("sha256").update(`profile:${sourceId}:${text.trim().toLocaleLowerCase()}`).digest("hex");

/** Brings profile facts up to date, or with `dryRun` reports what it would do. */
export function syncProfileKnowledge(
	userId: string,
	profile: MasterProfile,
	dryRun: boolean,
	now = new Date(),
): Promise<KnowledgeSyncResult> {
	const desired = profileFacts(profile, now);
	return db.transaction(async (tx) => {
		await lockUser(tx, userId);
		const existing = await tx
			.select()
			.from(tables.careerFact)
			.where(and(eq(tables.careerFact.userId, userId), sql`${tables.careerFact.source}->>'kind' = 'profile'`));
		const bySource = new Map(existing.map((fact) => [fact.source.id, fact]));
		const result: KnowledgeSyncResult = {
			added: 0,
			updated: 0,
			switchedOff: 0,
			keptCorrections: 0,
			keptOff: 0,
			unchanged: 0,
		};
		const changedIds: string[] = [];
		const toInsert: Array<typeof tables.careerFact.$inferInsert> = [];

		for (const fact of desired) {
			const current = bySource.get(fact.sourceId);
			bySource.delete(fact.sourceId);
			if (!current) {
				result.added++;
				toInsert.push({
					userId,
					applicationId: null,
					text: fact.text,
					category: fact.category,
					source: { kind: "profile", id: fact.sourceId, quote: fact.text },
					sourceKey: sourceKeyOf(fact.sourceId, fact.text),
				});
				continue;
			}
			if (current.status !== "active") {
				result.keptOff++;
				continue;
			}
			if (current.text !== current.source.quote) {
				result.keptCorrections++;
				continue;
			}
			if (current.text === fact.text && current.category === fact.category) {
				result.unchanged++;
				continue;
			}
			result.updated++;
			if (dryRun) continue;
			await tx
				.update(tables.careerFact)
				.set({
					text: fact.text,
					category: fact.category,
					source: { kind: "profile", id: fact.sourceId, quote: fact.text },
					sourceKey: sourceKeyOf(fact.sourceId, fact.text),
					revisions:
						current.text === fact.text
							? current.revisions
							: [...current.revisions, { text: current.text, at: now.toISOString() }].slice(-50),
				})
				.where(and(eq(tables.careerFact.id, current.id), eq(tables.careerFact.userId, userId)));
			changedIds.push(current.id);
		}

		// Whatever's left came from records that are now hidden or deleted.
		for (const fact of bySource.values()) {
			if (fact.status !== "active") continue;
			result.switchedOff++;
			if (dryRun) continue;
			await tx
				.update(tables.careerFact)
				.set({ status: "excluded" })
				.where(and(eq(tables.careerFact.id, fact.id), eq(tables.careerFact.userId, userId)));
			changedIds.push(fact.id);
		}

		if (dryRun) return result;
		// Facts list newest first. Staggering creation times by a millisecond keeps the most useful facts first.
		const rows = toInsert.map((row, index) => ({ ...row, createdAt: new Date(now.getTime() - index) }));
		for (let index = 0; index < rows.length; index += 200)
			await tx
				.insert(tables.careerFact)
				.values(rows.slice(index, index + 200))
				.onConflictDoNothing();
		// One call cancels in-flight coach replies that read the old knowledge.
		if (changedIds[0]) await invalidateMemory(userId, changedIds[0], tx);
		return result;
	});
}
