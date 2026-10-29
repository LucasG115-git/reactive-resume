import type { SelectEvidence } from "./service";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { profileAchievementInputSchema, profileEntryInputSchema } from "@reactive-resume/schema/master-profile";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

function getDb() {
	if (!fixture.db) throw new Error("Test database is not initialized.");
	return fixture.db;
}

// Real PostgreSQL, opt-in only. Every table and FK comes from shipped migrations in a unique schema.
describe.skipIf(!databaseUrl)("assemble a resume from the master profile", () => {
	let assemble: typeof import("./service").assembleService;
	let profile: typeof import("../service").masterProfileService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `assemble_test_${randomUUID().replaceAll("-", "")}`;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schemaName}` });
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (!existsSync(file)) continue;
			await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		assemble = (await import("./service")).assembleService;
		profile = (await import("../service")).masterProfileService;
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		await pool.query('TRUNCATE "user", "released_username" CASCADE');
		await getDb()
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
		const base = structuredClone(defaultResumeData);
		base.basics.name = "Alice Example";
		base.basics.email = "alice@example.test";
		await getDb()
			.insert(tables.resume)
			.values([
				{ id: "alice-base", userId: "alice", name: "General", slug: "general", data: base },
				{ id: "bob-base", userId: "bob", name: "Bob", slug: "bob", data: structuredClone(defaultResumeData) },
			]);
		await getDb()
			.insert(tables.application)
			.values([
				{
					id: "alice-app",
					userId: "alice",
					company: "Lumen",
					role: "Digital Project Manager",
					jobDescription: "We need a WordPress expert who manages nonprofit web projects.",
					requirements: ["WordPress", "Nonprofit experience"],
				},
				{ id: "bob-app", userId: "bob", company: "Other", role: "Other" },
			]);
	});

	async function seedProfile() {
		const role = await profile.saveEntry(
			"alice",
			profileEntryInputSchema.parse({
				kind: "position",
				organization: "Countdown Creative",
				title: "Founder",
				startDate: "2019-03",
			}),
		);
		const portal = await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({
				entryId: role.id,
				text: "Rebuilt a volunteer portal on WordPress, cutting admin time by 40%",
				metrics: [{ value: "40", unit: "%", label: "less admin time" }],
			}),
		);
		const clients = await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({ entryId: role.id, text: "Delivered sites for 12 nonprofits" }),
		);
		return { role, portal, clients };
	}

	/** A stand-in model that picks A1 and A2 and invents a number on the second. */
	const stub: SelectEvidence = async ({ prompt }) => {
		expect(prompt).toContain("<<<RECORD_START>>>");
		expect(prompt).toContain("Rebuilt a volunteer portal");
		expect(prompt).toContain("1. WordPress");
		return {
			model: "stub/test",
			output: {
				requirements: [{ requirement: "WordPress", ids: ["A1"], strength: "strong" }],
				achievements: [
					{ id: "A1", text: "Cut admin time 40% by rebuilding a WordPress volunteer portal" },
					{ id: "A2", text: "Delivered sites for 30 nonprofits" },
				],
				skills: [],
				summary: "",
			},
		};
	};

	it("creates a linked resume from the profile and records where each line came from", async () => {
		const { portal, clients } = await seedProfile();
		const response = await assemble.assemble(
			"alice",
			{ applicationId: "alice-app", baseResumeId: "alice-base", mode: "rephrase" },
			{ select: stub, now: new Date("2026-10-29") },
		);

		const [created] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, response.resumeId));
		expect(created).toMatchObject({
			userId: "alice",
			applicationId: "alice-app",
			name: "Digital Project Manager — Lumen",
		});
		const data = created?.data as typeof defaultResumeData;
		expect(data.basics.name).toBe("Alice Example");
		const description = data.sections.experience.items[0]?.description ?? "";
		expect(description).toContain("Cut admin time 40% by rebuilding a WordPress volunteer portal");
		// The invented "30" was rejected; the user's own wording was kept.
		expect(description).toContain("Delivered sites for 12 nonprofits");
		expect(description).not.toContain("30 nonprofits");

		// The base resume is untouched, and the application now points at the tailored copy.
		const [base] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, "alice-base"));
		expect((base?.data as typeof defaultResumeData | undefined)?.sections.experience.items).toEqual([]);
		const [app] = await getDb().select().from(tables.application).where(eq(tables.application.id, "alice-app"));
		expect(app?.resumeId).toBe(response.resumeId);

		expect(response.result.bullets).toEqual([
			expect.objectContaining({ achievementId: portal.id, source: "rephrased" }),
			expect.objectContaining({ achievementId: clients.id, source: "original" }),
		]);
		expect(response.result.coverage).toEqual([
			{ requirement: "WordPress", strength: "strong", achievementIds: [portal.id], skillIds: [] },
		]);
		expect(response.result.warnings).toHaveLength(1);

		const latest = await assemble.latest("alice", "alice-app");
		expect(latest).toMatchObject({ id: response.assemblyId, resumeId: response.resumeId, model: "stub/test" });
		expect(await assemble.latest("bob", "alice-app")).toBeNull();
	});

	it("refuses other users' applications and resumes, and an empty profile", async () => {
		await expect(
			assemble.assemble(
				"alice",
				{ applicationId: "alice-app", baseResumeId: "alice-base", mode: "rephrase" },
				{ select: stub },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		await seedProfile();
		await expect(
			assemble.assemble(
				"alice",
				{ applicationId: "bob-app", baseResumeId: "alice-base", mode: "rephrase" },
				{ select: stub },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			assemble.assemble(
				"alice",
				{ applicationId: "alice-app", baseResumeId: "bob-base", mode: "rephrase" },
				{ select: stub },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
