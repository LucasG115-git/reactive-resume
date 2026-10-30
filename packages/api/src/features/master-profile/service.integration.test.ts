import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
	profileAchievementInputSchema,
	profileEntryInputSchema,
	profileSkillInputSchema,
} from "@reactive-resume/schema/master-profile";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
	pool: undefined as Pool | undefined,
}));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

function getPool(): Pool {
	if (!fixture.pool) throw new Error("Test database is not initialized");
	return fixture.pool;
}

const entry = (input: Record<string, unknown>) => profileEntryInputSchema.parse(input);
const achievement = (input: Record<string, unknown>) => profileAchievementInputSchema.parse(input);
const skill = (input: Record<string, unknown>) => profileSkillInputSchema.parse(input);

// Opt-in real PostgreSQL tests. Use a disposable database; all tables live in an isolated schema.
describe.skipIf(!databaseUrl)("master profile persistence", () => {
	let service: typeof import("./service").masterProfileService;
	const schemaName = `master_profile_test_${randomUUID().replaceAll("-", "")}`;
	let admin: Pool;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		fixture.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
		fixture.db = drizzle({ client: fixture.pool });
		await fixture.pool.query(`CREATE TABLE "user" (id text PRIMARY KEY);`);
		const migration = await readFile(
			new URL("../../../../../migrations/20261029222356_master_profile/migration.sql", import.meta.url),
			"utf8",
		);
		for (const statement of migration.split("--> statement-breakpoint")) {
			const sql = statement.trim();
			if (sql) await fixture.pool.query(sql);
		}
		service = (await import("./service")).masterProfileService;
	});
	afterAll(async () => {
		await fixture.pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});
	beforeEach(async () => {
		await getPool().query('TRUNCATE "user" CASCADE');
		await getPool().query("INSERT INTO \"user\" VALUES ('alice'),('bob')");
	});

	it("groups achievements under entries and orders entries newest first", async () => {
		const old = await service.saveEntry(
			"alice",
			entry({ kind: "position", organization: "Old Co", title: "Analyst", startDate: "2015-01", endDate: "2018-06" }),
		);
		const current = await service.saveEntry(
			"alice",
			entry({ kind: "position", organization: "Countdown Creative", title: "Founder", startDate: "2019-03" }),
		);
		await service.reorder("alice", { table: "entry", ids: [old.id, current.id] });
		await service.reorder("alice", { table: "entry", ids: [current.id, old.id] });

		const bullet = await service.saveAchievement(
			"alice",
			achievement({
				entryId: current.id,
				text: "Cut volunteer admin time by 40%",
				metrics: [{ value: "40", unit: "%", label: "less admin time" }],
				skills: ["WordPress"],
				core: true,
			}),
		);
		await service.saveAchievement("alice", achievement({ text: "Standalone award-winning talk" }));

		const profile = await service.get("alice");
		expect(profile.entries.map((e) => e.title)).toEqual(["Founder", "Analyst"]);
		expect(profile.entries[0]?.achievements.map((a) => a.id)).toEqual([bullet.id]);
		expect(profile.entries[0]?.achievements[0]?.metrics).toEqual([
			{ value: "40", unit: "%", label: "less admin time" },
		]);
		expect(profile.standalone.map((a) => a.text)).toEqual(["Standalone award-winning talk"]);
	});

	it("keeps users' profiles apart", async () => {
		const aliceEntry = await service.saveEntry("alice", entry({ kind: "project", title: "Civic app" }));

		expect((await service.get("bob")).entries).toEqual([]);
		await expect(
			service.saveAchievement("bob", achievement({ entryId: aliceEntry.id, text: "Not mine" })),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			service.saveEntry("bob", entry({ kind: "project", title: "Hijack" }), aliceEntry.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(service.reorder("bob", { table: "entry", ids: [aliceEntry.id] })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await service.deleteEntry("bob", aliceEntry.id);
		expect((await service.get("alice")).entries).toHaveLength(1);
	});

	it("deletes an entry's achievements with it", async () => {
		const removed = await service.saveEntry("alice", entry({ kind: "volunteer", title: "UX Chair" }));
		await service.saveAchievement("alice", achievement({ entryId: removed.id, text: "Ran usability tests" }));
		await service.deleteEntry("alice", removed.id);

		const { rows } = await getPool().query("SELECT count(*)::int AS n FROM profile_achievement");
		expect(rows[0].n).toBe(0);
	});

	it("rejects duplicate skill names regardless of case", async () => {
		await service.saveSkill("alice", skill({ name: "JavaScript", category: "Web", aliases: ["JS"] }));
		await expect(service.saveSkill("alice", skill({ name: "javascript" }))).rejects.toMatchObject({
			code: "CONFLICT",
		});
		// Another user may use the same name.
		await expect(service.saveSkill("bob", skill({ name: "JavaScript" }))).resolves.toMatchObject({
			name: "JavaScript",
		});
	});
});

describe("profile entry input", () => {
	it("accepts partial dates and rejects an end before the start", () => {
		expect(entry({ kind: "education", title: "BBA", startDate: "2010", endDate: "2014-04" }).endDate).toBe("2014-04");
		expect(() => entry({ kind: "position", title: "x", startDate: "2020-05", endDate: "2019" })).toThrow();
		expect(() => entry({ kind: "position", title: "x", startDate: "2020-13" })).toThrow();
	});
});
