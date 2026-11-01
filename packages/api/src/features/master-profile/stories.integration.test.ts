import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
describe.skipIf(!databaseUrl)("importing a story file", () => {
	let profile: typeof import("./service").masterProfileService;
	let career: typeof import("../career/service").careerService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `story_import_test_${randomUUID().replaceAll("-", "")}`;

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
		await profile.saveAchievement(
			"alice",
			profileAchievementInputSchema.parse({
				entryId: role.id,
				text: "Built a daily membership sync for a PMI chapter",
			}),
		);
		await profile.saveSkill("alice", profileSkillInputSchema.parse({ name: "WordPress", category: "Web" }));
		await profile.syncKnowledge("alice", false);
		const { factCatalog } = await import("./stories");
		return factCatalog("alice");
	}

	const story = (facts: string[], title = "Automating chapter membership checks") => ({
		title,
		tags: "automation, associations",
		situation: "Volunteers verified member discounts by hand.",
		task: "Make member status available to the website.",
		action: "Built a pipeline from the emailed export to WordPress.",
		result: null,
		reflection: "Ask for API access earlier.",
		facts,
	});

	it("links stories to cited facts, previews without saving, and skips existing titles", async () => {
		const { importStories } = await import("./stories");
		const { storyFileSchema } = await import("@reactive-resume/schema/master-profile");
		const catalog = await seed();
		expect(catalog.map((fact) => fact.category).toSorted()).toEqual(["accomplishment", "experience", "skill"]);
		expect(catalog.every((fact) => /^F-[0-9a-f]{8}$/.test(fact.ref))).toBe(true);
		const membership = catalog.find((fact) => fact.text.startsWith("Built a daily membership sync"));
		const file = storyFileSchema.parse({ version: 1, stories: [story([membership?.ref.toUpperCase() ?? ""])] });

		const preview = await importStories("alice", file, true);
		expect(preview).toEqual({
			stories: [{ title: "Automating chapter membership checks", isNew: true, facts: [membership?.text] }],
			added: 1,
			skipped: [],
		});
		expect(await career.stories({ userId: "alice", applicationId: null })).toHaveLength(0);

		expect(await importStories("alice", file, false)).toEqual(preview);
		const [saved] = await career.stories({ userId: "alice", applicationId: null });
		expect(saved?.data).toMatchObject({
			title: "Automating chapter membership checks",
			result: "",
			reflection: "Ask for API access earlier.",
			tags: ["automation", "associations"],
		});
		const facts = await career.facts({ userId: "alice", applicationId: null, all: true });
		expect(saved?.data.factIds).toEqual([facts.find((fact) => fact.text === membership?.text)?.id]);

		expect(await importStories("alice", file, false)).toMatchObject({
			added: 0,
			skipped: ["Automating chapter membership checks"],
		});
		expect(await career.stories({ userId: "alice", applicationId: null })).toHaveLength(1);
	});

	it("refuses facts that are unknown, switched off or someone else's", async () => {
		const { importStories, factCatalog } = await import("./stories");
		const { ProfileFileError } = await import("./import");
		const { storyFileSchema } = await import("@reactive-resume/schema/master-profile");
		const catalog = await seed();
		const skill = catalog.find((fact) => fact.category === "skill");
		const facts = await career.facts({ userId: "alice", applicationId: null, all: true });
		await career.updateFact("alice", {
			id: facts.find((fact) => fact.category === "skill")?.id ?? "",
			status: "excluded",
		});
		expect((await factCatalog("alice")).some((fact) => fact.ref === skill?.ref)).toBe(false);

		const file = storyFileSchema.parse({ stories: [story([skill?.ref ?? "", "F-00000000"])] });
		const refused = await importStories("alice", file, true).catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(ProfileFileError);
		expect((refused as InstanceType<typeof ProfileFileError>).problems).toEqual([
			`stories[0].facts: ${skill?.ref} isn't one of your switched-on facts`,
			"stories[0].facts: F-00000000 isn't one of your switched-on facts",
		]);
		const forBob = await importStories(
			"bob",
			storyFileSchema.parse({ stories: [story([catalog[0]?.ref ?? ""])] }),
			true,
		).catch((error: unknown) => error);
		expect(forBob).toBeInstanceOf(ProfileFileError);
	});

	it("checks the file's shape with readable messages", async () => {
		const { storyFileSchema } = await import("@reactive-resume/schema/master-profile");
		expect(storyFileSchema.safeParse({ stories: [] }).success).toBe(false);
		const missing = storyFileSchema.safeParse({
			stories: [{ title: "T", situation: "S", task: "", action: "A", facts: ["F-1"] }],
		});
		expect(missing.success).toBe(false);
		expect(missing.error?.issues.map((issue) => issue.message)).toEqual([
			"Task is required",
			"Fact ids look like F-1a2b3c4d",
		]);
	});
});
