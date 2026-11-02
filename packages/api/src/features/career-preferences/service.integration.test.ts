import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { careerProfileDataSchema } from "@reactive-resume/schema/career";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

const rule = (input: Record<string, unknown>) => ({
	places: [],
	country: null,
	arrangements: ["remote"],
	priority: "must",
	...input,
});

const structured = {
	version: 1,
	locationRules: [
		rule({
			id: "home",
			label: "Peterborough",
			scope: "places",
			places: ["Peterborough"],
			arrangements: ["onsite", "hybrid"],
		}),
		rule({
			id: "gta",
			label: "Toronto",
			scope: "places",
			places: ["Toronto"],
			arrangements: ["remote", "hybrid"],
			maxOfficeDays: 1,
		}),
		rule({ id: "canada", label: "Canada", scope: "country", country: "CA", arrangements: ["remote"] }),
	],
	salary: { currency: "CAD", period: "year", floor: 70000, preferred: 95000, targetMin: null, targetMax: null },
	organization: [],
};

// Real PostgreSQL, opt-in only. Every table and FK comes from shipped migrations in a unique schema.
describe.skipIf(!databaseUrl)("structured preferences", () => {
	let career: typeof import("../career/service").careerService;
	let preferences: typeof import("./service").careerPreferencesService;
	let jobs: typeof import("../career/jobs").careerJobs;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `preferences_test_${randomUUID().replaceAll("-", "")}`;
	const db = () => {
		if (!fixture.db) throw new Error("No database.");
		return fixture.db;
	};

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
		career = (await import("../career/service")).careerService;
		preferences = (await import("./service")).careerPreferencesService;
		jobs = (await import("../career/jobs")).careerJobs;
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		await pool.query('TRUNCATE "user", "released_username" CASCADE');
		await db()
			.insert(tables.user)
			.values(
				["alice", "bob"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
					username: id,
					displayUsername: id,
				})),
			);
	});

	const saveStructured = () =>
		career.saveProfile("alice", careerProfileDataSchema.parse({ maxOfficeDays: 2, structured }));

	const addApplication = async (userId: string, role: string, location: string, jobDescription: string) => {
		const [row] = await db()
			.insert(tables.application)
			.values({ userId, company: "ACME", role, location, jobDescription })
			.returning({ id: tables.application.id });
		if (!row) throw new Error("No application.");
		return row.id;
	};

	it("keeps structured preferences and existing ones when another client saves without them", async () => {
		const saved = await saveStructured();
		expect(saved.structured?.locationRules.map((entry) => entry.id)).toEqual(["home", "gta", "canada"]);
		// An older client (mobile) sends only the fields it knows.
		const { structured: _omitted, ...legacy } = saved;
		const next = await career.saveProfile("alice", { ...legacy, notice: "2 weeks" } as typeof saved);
		expect(next.structured).toEqual(saved.structured);
		expect(next.maxOfficeDays).toBe(2);
		expect((await career.profile("alice")).structured?.salary?.floor).toBe(70000);
	});

	it("never turns existing preferences into must-haves", async () => {
		await career.saveProfile("alice", careerProfileDataSchema.parse({ maxOfficeDays: 1, locations: ["Toronto"] }));
		const id = await addApplication("alice", "Designer", "Toronto, ON", "Hybrid, 3 days a week in the office.");
		const evaluation = await preferences.evaluateApplication("alice", id);
		expect(evaluation.verdict).toBe("fits");
		expect(evaluation.checks.find((check) => check.key === "legacy:office-days")).toMatchObject({
			priority: "strong",
			status: "violated",
			legacy: true,
		});
	});

	it("applies the more specific location rule and reports unknown pay without rejecting", async () => {
		await saveStructured();
		const toronto = await addApplication("alice", "Designer", "Toronto, Ontario", "On-site role, five days a week.");
		const remote = await addApplication("alice", "Designer", "Halifax, Nova Scotia, Canada", "Fully remote.");
		const conflict = await preferences.evaluateApplication("alice", toronto);
		expect(conflict).toMatchObject({ verdict: "conflict", rule: { id: "gta" } });
		const unknown = await preferences.evaluateApplication("alice", remote);
		expect(unknown.rule?.id).toBe("canada");
		expect(unknown.verdict).toBe("check");
		expect(unknown.checks.find((check) => check.key === "salary:floor")?.status).toBe("unknown");
	});

	it("sets a preference aside for one application only, and keeps it private to its owner", async () => {
		await saveStructured();
		const first = await addApplication("alice", "Designer", "Toronto", "On-site, five days a week.");
		const second = await addApplication("alice", "Designer", "Toronto", "On-site, five days a week.");
		const key = "location:gta:arrangement";
		const after = await preferences.setOverride("alice", {
			applicationId: first,
			key,
			overridden: true,
			note: "Worth it",
		});
		expect(after.checks.find((check) => check.key === key)?.status).toBe("overridden");
		expect(
			(await preferences.evaluateApplication("alice", second)).checks.find((check) => check.key === key)?.status,
		).toBe("violated");
		await expect(preferences.evaluateApplication("bob", first)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(preferences.setOverride("bob", { applicationId: first, key, overridden: true })).rejects.toMatchObject(
			{
				code: "NOT_FOUND",
			},
		);
		const restored = await preferences.setOverride("alice", { applicationId: first, key, overridden: false });
		expect(restored.checks.find((check) => check.key === key)?.status).toBe("violated");
	});

	it("ranks discovered roles by preferences, keeping every role with its reasons", async () => {
		await saveStructured();
		await db()
			.insert(tables.careerOpportunity)
			.values([
				{
					userId: "alice",
					url: "https://example.test/onsite",
					role: "Designer",
					location: "Toronto, ON",
					snippet: "On-site, 5 days a week. $110,000 a year.",
					lastSeenAt: new Date("2026-11-02T10:00:00Z"),
				},
				{
					userId: "alice",
					url: "https://example.test/unknown",
					role: "Designer",
					location: "Remote, Canada",
					snippet: "Fully remote across Canada.",
					lastSeenAt: new Date("2026-11-02T09:00:00Z"),
				},
				{
					userId: "alice",
					url: "https://example.test/fits",
					role: "Designer",
					location: "Peterborough, ON",
					snippet: "Hybrid. Salary: $100,000 per year.",
					lastSeenAt: new Date("2026-11-01T09:00:00Z"),
				},
			]);
		const ranked = await jobs.opportunities("alice");
		expect(ranked.map((role) => [role.url.split("/").at(-1), role.evaluation.verdict])).toEqual([
			["fits", "fits"],
			["unknown", "check"],
			["onsite", "conflict"],
		]);
		expect(ranked.at(-1)?.evaluation.summary).toMatch(/^Doesn't meet/);
		expect(ranked[1]?.evaluation.summary).toMatch(/confirm/);
	});
});
