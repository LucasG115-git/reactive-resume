import type { StoryFile } from "@reactive-resume/schema/master-profile";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { careerStoryInputSchema } from "@reactive-resume/schema/career";
import { factRef } from "@reactive-resume/schema/master-profile";
import { careerService } from "../career/service";
import { ProfileFileError } from "./import";

/**
 * Bulk STARR stories. Stories cite the facts behind them; an AI assistant can't see fact ids, so it gets a
 * catalog of the user's switched-on, shared facts with short ids ("F-1a2b3c4d") and cites those.
 */

export type FactCatalogEntry = { ref: string; category: string; text: string };

/** Facts a story for all applications may cite: switched on and not private to one application. */
function citableFacts(userId: string) {
	return db
		.select({ id: tables.careerFact.id, text: tables.careerFact.text, category: tables.careerFact.category })
		.from(tables.careerFact)
		.where(
			and(
				eq(tables.careerFact.userId, userId),
				eq(tables.careerFact.status, "active"),
				isNull(tables.careerFact.applicationId),
			),
		)
		.orderBy(tables.careerFact.category, tables.careerFact.text);
}

export async function factCatalog(userId: string): Promise<FactCatalogEntry[]> {
	return (await citableFacts(userId)).map((fact) => ({
		ref: factRef(fact.id),
		category: fact.category,
		text: fact.text,
	}));
}

export type StoryImportPreview = {
	stories: Array<{ title: string; isNew: boolean; facts: string[] }>;
	added: number;
	/** Titles already in Knowledge, left as they are. */
	skipped: string[];
};

/** Validates a story file against the user's facts; saves the new stories unless `dryRun`. */
export async function importStories(userId: string, file: StoryFile, dryRun: boolean): Promise<StoryImportPreview> {
	const facts = await citableFacts(userId);
	const byRef = new Map<string, (typeof facts)[number] | null>();
	// Two facts can't share a short id in practice; if they ever do, the id is ambiguous and refused.
	for (const fact of facts) byRef.set(factRef(fact.id), byRef.has(factRef(fact.id)) ? null : fact);

	const existing = await db
		.select({ title: sql<string>`${tables.careerStory.data}->>'title'` })
		.from(tables.careerStory)
		.where(and(eq(tables.careerStory.userId, userId), isNull(tables.careerStory.applicationId)));
	const titles = new Set(existing.map((row) => row.title.trim().toLocaleLowerCase()));

	const problems: string[] = [];
	const planned: Array<{ input: ReturnType<typeof careerStoryInputSchema.parse>; facts: string[]; isNew: boolean }> =
		[];
	file.stories.forEach((story, index) => {
		const ids: string[] = [];
		const texts: string[] = [];
		for (const ref of story.facts) {
			const fact = byRef.get(`F-${ref.slice(2).toLowerCase()}`);
			if (fact === undefined) problems.push(`stories[${index}].facts: ${ref} isn't one of your switched-on facts`);
			else if (fact === null)
				problems.push(`stories[${index}].facts: ${ref} matches more than one fact; link it by hand`);
			else {
				ids.push(fact.id);
				texts.push(fact.text);
			}
		}
		const key = story.title.toLocaleLowerCase();
		const isNew = !titles.has(key);
		titles.add(key);
		planned.push({
			input: careerStoryInputSchema.parse({
				applicationId: null,
				title: story.title,
				situation: story.situation,
				task: story.task,
				action: story.action,
				result: story.result,
				reflection: story.reflection,
				factIds: ids,
				tags: story.tags,
			}),
			facts: texts,
			isNew,
		});
	});
	if (problems.length > 0) throw new ProfileFileError(problems.slice(0, 25));

	const preview: StoryImportPreview = {
		stories: planned.map((story) => ({ title: story.input.title, isNew: story.isNew, facts: story.facts })),
		added: planned.filter((story) => story.isNew).length,
		skipped: planned.filter((story) => !story.isNew).map((story) => story.input.title),
	};
	if (dryRun) return preview;
	for (const story of planned) if (story.isNew) await careerService.saveStory(userId, story.input);
	return preview;
}
