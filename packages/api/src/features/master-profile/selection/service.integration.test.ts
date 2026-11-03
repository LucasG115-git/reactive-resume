import type { AskModel } from "./model";
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
describe.skipIf(!databaseUrl)("resume selection plans", () => {
	let selection: typeof import("./service").selectionService;
	let assemble: typeof import("../assemble/service").assembleService;
	let profile: typeof import("../service").masterProfileService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `selection_test_${randomUUID().replaceAll("-", "")}`;

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
		selection = (await import("./service")).selectionService;
		assemble = (await import("../assemble/service")).assembleService;
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
		const founder = await profile.saveEntry(
			"alice",
			profileEntryInputSchema.parse({
				kind: "position",
				organization: "Countdown Creative",
				title: "Founder",
				startDate: "2019-03",
			}),
		);
		const retail = await profile.saveEntry(
			"alice",
			profileEntryInputSchema.parse({
				kind: "position",
				organization: "Shop",
				title: "Sales Associate",
				startDate: "2010-01",
				endDate: "2012-01",
			}),
		);
		const add = (entryId: string, text: string) =>
			profile.saveAchievement("alice", profileAchievementInputSchema.parse({ entryId, text }));
		const portal = await add(
			founder.id,
			"Rebuilt a nonprofit volunteer portal on WordPress, cutting admin time by 40%",
		);
		const sites = await add(founder.id, "Delivered WordPress sites for 12 nonprofits on schedule");
		const bakery = await add(founder.id, "Designed a logo for a bakery");
		const till = await add(retail.id, "Handled the till and stocked shelves");
		return { founder, retail, portal, sites, bakery, till };
	}

	const calls: string[] = [];
	/** A stand-in AI: a job analysis, no usable review (so the ranking decides), then wording. */
	const ask: AskModel = async ({ system, prompt, schema }) => {
		calls.push(system.slice(0, 20));
		if (system.startsWith("You analyse job postings")) {
			expect(prompt).toContain("WordPress expert");
			return {
				model: "stub/analyse",
				output: schema.parse({
					title: "Digital Project Manager",
					employer: "Lumen",
					seniority: "manager",
					requirements: [
						{ text: "WordPress development", importance: 5, necessity: "mandatory", terms: ["websites"] },
						{ text: "Nonprofit sector experience", importance: 4, necessity: "mandatory", terms: ["charity"] },
						{ text: "French fluency", importance: 2, necessity: "preferred" },
					],
				}),
			};
		}
		return { model: "stub/review", output: schema.parse({}) };
	};

	it("proposes a plan from the full profile, saves edits without touching the profile, and builds from it", async () => {
		const seeded = await seedProfile();
		// Switching an achievement's fact off in Knowledge keeps it out of tailoring.
		await getDb()
			.insert(tables.careerFact)
			.values({
				userId: "alice",
				text: "Designed a logo for a bakery",
				category: "accomplishment",
				source: { kind: "profile", id: `achievement:${seeded.bakery.id}`, quote: "Designed a logo for a bakery" },
				sourceKey: `profile:achievement:${seeded.bakery.id}`,
				status: "excluded",
			} as never);

		const proposed = await selection.propose(
			"alice",
			{ applicationId: "alice-app" },
			{ ask, now: new Date("2026-11-01") },
		);
		expect(proposed?.analysis.requirements.map((item) => item.id)).toEqual(["R1", "R2", "R3"]);
		const plan = proposed?.plan;
		if (!plan) throw new Error("No plan.");
		expect(plan.source).toBe("ranking");
		expect(plan.entries.map((entry) => [entry.entryId, entry.include])).toEqual([
			[seeded.founder.id, true],
			[seeded.retail.id, false],
		]);
		expect(plan.unavailable).toEqual([
			{ id: seeded.bakery.id, kind: "achievement", reason: "Switched off in Career Knowledge" },
		]);
		expect(plan.coverage.map((item) => item.status)).toEqual(["supported", "supported", "gap"]);
		expect(proposed?.postingText).toContain("WordPress expert");
		expect(await selection.get("bob", "alice-app").catch((error: { code: string }) => error.code)).toBe("NOT_FOUND");

		// The analysis is reused while the posting is unchanged.
		calls.length = 0;
		await selection.propose("alice", { applicationId: "alice-app" }, { ask });
		expect(calls).toEqual(["You review a candida"]);

		// The user keeps only the sites bullet and adds the retail role.
		const edited = await selection.update("alice", {
			applicationId: "alice-app",
			entries: [
				{
					entryId: seeded.founder.id,
					include: true,
					achievements: [
						{ achievementId: seeded.sites.id, include: true },
						{ achievementId: seeded.portal.id, include: false },
					],
				},
				{ entryId: seeded.retail.id, include: true, achievements: [{ achievementId: seeded.till.id, include: true }] },
			],
			skills: [],
		});
		expect(edited?.plan.totals).toMatchObject({ includedEntries: 2, includedAchievements: 2 });
		expect(edited?.proposed.totals.includedEntries).toBe(1);
		const [portal] = await getDb()
			.select()
			.from(tables.profileAchievement)
			.where(eq(tables.profileAchievement.id, seeded.portal.id));
		expect(portal?.hidden).toBe(false);

		const built = await assemble.assemble(
			"alice",
			{ applicationId: "alice-app", mode: "verbatim" },
			{
				select: async () => {
					throw new Error("verbatim from a plan needs no AI");
				},
			},
		);
		const [resume] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, built.resumeId));
		const data = resume?.data as typeof defaultResumeData;
		expect(data.sections.experience.items.map((item) => item.position)).toEqual(["Founder", "Sales Associate"]);
		expect(data.sections.experience.items[0]?.description).toContain("Delivered WordPress sites");
		expect(data.sections.experience.items[0]?.description).not.toContain("volunteer portal");
		expect(built.result.coverage.find((item) => item.requirement === "French fluency")?.strength).toBe("none");
		// The writing report and quality checks are kept with the assembly.
		expect(built.result.writing?.stats.positions).toBe(2);
		expect(built.result.writing?.checks.filter((finding) => finding.severity === "error")).toEqual([]);
		expect(built.result.writing?.rules.region).toBe("CA");

		const reset = await selection.reset("alice", "alice-app");
		expect(reset?.plan.totals.includedEntries).toBe(1);
	});

	it("asks for a posting and achievements first", async () => {
		await expect(selection.propose("bob", { applicationId: "bob-app" }, { ask })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(selection.propose("alice", { applicationId: "alice-app" }, { ask })).rejects.toMatchObject({
			message: expect.stringMatching(/no achievements/),
		});
	});
});
