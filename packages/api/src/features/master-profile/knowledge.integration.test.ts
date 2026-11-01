import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import {
	profileAchievementInputSchema,
	profileEntryInputSchema,
	profileSkillInputSchema,
} from "@reactive-resume/schema/master-profile";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only. Every table and FK comes from shipped migrations in a unique schema.
describe.skipIf(!databaseUrl)("syncing the master profile to Career Knowledge", () => {
	let profile: typeof import("./service").masterProfileService;
	let career: typeof import("../career/service").careerService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `knowledge_sync_test_${randomUUID().replaceAll("-", "")}`;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schemaName}` });
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (!existsSync(file)) continue;
			await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		profile = (await import("./service")).masterProfileService;
		career = (await import("../career/service")).careerService;
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		await pool.query('TRUNCATE "user", "released_username" CASCADE');
		await fixture.db?.insert(tables.user).values(
			["alice", "bob"].map((id) => ({
				id,
				name: id,
				email: `${id}@example.test`,
				username: id,
				displayUsername: id,
			})),
		);
	});

	const profileFacts = async (userId = "alice") =>
		fixture.db
			?.select()
			.from(tables.careerFact)
			.where(and(eq(tables.careerFact.userId, userId), sql`${tables.careerFact.source}->>'kind' = 'profile'`));

	async function seed() {
		const role = await profile.saveEntry(
			"alice",
			profileEntryInputSchema.parse({
				kind: "position",
				organization: "Countdown Creative",
				title: "Founder",
				startDate: "2020-06",
			}),
		);
		const sync = await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({
				entryId: role.id,
				text: "Built a daily membership sync for a PMI chapter",
			}),
		);
		const measured = await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({
				entryId: role.id,
				text: "Launched about 25 client websites",
				metrics: [{ value: "25", unit: "websites", label: "" }],
			}),
		);
		await profile.saveEntry("alice", profileEntryInputSchema.parse({ kind: "project", title: "Secret", hidden: true }));
		await profile.saveSkill("alice", profileSkillInputSchema.parse({ name: "WordPress", category: "Web" }));
		await profile.saveSkill("alice", profileSkillInputSchema.parse({ name: "PHP", category: "Web" }));
		return { role, sync, measured };
	}

	it("adds shared facts for visible records, most useful first, and previews exactly what it does", async () => {
		await seed();
		const preview = await profile.syncKnowledge("alice", true);
		expect(preview).toEqual({ added: 4, updated: 0, switchedOff: 0, keptCorrections: 0, keptOff: 0, unchanged: 0 });
		expect(await profileFacts()).toHaveLength(0);

		expect(await profile.syncKnowledge("alice", false)).toEqual(preview);
		const facts = await career.facts({ userId: "alice", applicationId: null, all: true });
		// Skills, then the measured achievement, then recent achievements, then the role line.
		expect(facts.map((fact) => [fact.category, fact.text])).toEqual([
			["skill", "Skills — Web: WordPress, PHP."],
			["accomplishment", "Launched about 25 client websites (Founder, Countdown Creative, 2020-06–present)."],

			[
				"accomplishment",
				"Built a daily membership sync for a PMI chapter (Founder, Countdown Creative, 2020-06–present).",
			],
			["experience", "Role: Founder, Countdown Creative, 2020-06–present."],
		]);
		expect(facts.every((fact) => fact.applicationId === null && fact.status === "active")).toBe(true);
		expect(facts[0]?.source).toMatchObject({ kind: "profile", quote: "Skills — Web: WordPress, PHP." });
		expect((await profile.syncKnowledge("alice", false)).unchanged).toBe(4);
		expect(await profileFacts("bob")).toHaveLength(0);
	});

	it("updates edited records with history, but never overrides the user's own choices in Knowledge", async () => {
		const { role, sync, measured } = await seed();
		await profile.syncKnowledge("alice", false);
		const byText = async (start: string) =>
			(await career.facts({ userId: "alice", applicationId: null, all: true })).find((fact) =>
				fact.text.startsWith(start),
			);

		// A profile edit flows through and keeps the old text in history, so stories using it are flagged.
		await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({
				entryId: role.id,
				text: "Built a daily membership sync for two PMI chapters",
			}),
			sync.id,
		);
		expect((await profile.syncKnowledge("alice", false)).updated).toBe(1);
		const updated = await byText("Built a daily membership sync for two");
		expect(updated?.revisions.map((revision) => revision.text)).toEqual([
			"Built a daily membership sync for a PMI chapter (Founder, Countdown Creative, 2020-06–present).",
		]);

		// A correction made in Knowledge wins over later profile edits.
		await career.updateFact("alice", { id: updated?.id ?? "", text: "Built a daily membership sync (my wording)" });
		await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({ entryId: role.id, text: "Built a membership sync, edited again" }),
			sync.id,
		);
		expect((await profile.syncKnowledge("alice", false)).keptCorrections).toBe(1);
		expect(await byText("Built a daily membership sync (my wording)")).toBeTruthy();

		// Switched off in Knowledge stays off; hiding a record switches its fact off; forgotten is never recreated.
		const skills = await byText("Skills — Web");
		await career.updateFact("alice", { id: skills?.id ?? "", status: "excluded" });
		await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({
				entryId: role.id,
				text: "Launched about 25 client websites",
				hidden: true,
			}),
			measured.id,
		);
		const roleFact = await byText("Role: Founder");
		await career.forgetFact("alice", roleFact?.id ?? "");

		expect(await profile.syncKnowledge("alice", false)).toEqual({
			added: 0,
			updated: 0,
			switchedOff: 1,
			keptCorrections: 1,
			keptOff: 2,
			unchanged: 0,
		});
		const statuses = Object.fromEntries(
			(await profileFacts())?.map((fact) => [fact.source.id.split(":")[0], fact.status]) ?? [],
		);
		expect(statuses).toMatchObject({ skills: "excluded", entry: "forgotten" });
		const hiddenFact = (await profileFacts())?.find((fact) => fact.source.id === `achievement:${measured.id}`);
		expect(hiddenFact?.status).toBe("excluded");
	});
});
