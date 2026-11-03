import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { DEFAULT_STYLE_GUIDE, presetFromTemplate } from "@reactive-resume/schema/resume-style";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only. Every table and FK comes from shipped migrations in a unique schema.
describe.skipIf(!databaseUrl)("resume style guide", () => {
	let style: typeof import("./service").resumeStyleService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `style_test_${randomUUID().replaceAll("-", "")}`;
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
		style = (await import("./service")).resumeStyleService;
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
		const data = structuredClone(defaultResumeData);
		data.basics.name = "Alice Example";
		data.summary.content = `<p>${"Communications lead for regional nonprofits, writing campaigns and annual reports. ".repeat(4)}</p>`;
		await db()
			.insert(tables.resume)
			.values({ id: "alice-cv", userId: "alice", name: "Alice CV", slug: "alice-cv", data });
	});

	it("starts from the default, keeps example text out of reach of saves, and limits examples", async () => {
		expect(await style.get("alice")).toEqual(DEFAULT_STYLE_GUIDE);
		const fromResume = await style.addExampleFromResume("alice", {
			resumeId: "alice-cv",
			notes: "the summary's voice",
		});
		expect(fromResume).toMatchObject({ title: "Alice CV", source: "resume", resumeId: "alice-cv" });
		expect(fromResume.text).toContain("Communications lead");
		const file = new File(["Delivered a 40-page annual report on time. ".repeat(5)], "Jordan Resume.txt");
		const fromFile = await style.addExampleFromFile("alice", { file });
		expect(fromFile).toMatchObject({ title: "Jordan Resume", source: "upload" });

		const guide = await style.get("alice");
		const comms = { ...presetFromTemplate("communications", "comms"), exampleIds: [fromResume.id, "missing"] };
		const saved = await style.save("alice", {
			...guide,
			defaultPresetId: "comms",
			presets: [...guide.presets, comms],
			// A save can rename or annotate an example, never replace its text or add one.
			examples: [
				{ ...fromResume, title: "My favourite", text: "INJECTED" },
				{ ...fromFile, id: "new-one", text: "INJECTED" },
			],
		});
		expect(saved.examples).toHaveLength(1);
		expect(saved.examples[0]).toMatchObject({ id: fromResume.id, title: "My favourite" });
		expect(saved.examples[0]?.text).toContain("Communications lead");
		expect(saved.presets.find((preset) => preset.id === "comms")?.exampleIds).toEqual([fromResume.id]);
		expect((await style.get("alice")).defaultPresetId).toBe("comms");
		expect(await style.get("bob")).toEqual(DEFAULT_STYLE_GUIDE);

		for (let index = 0; index < 5; index++) await style.addExampleFromFile("alice", { file });
		await expect(style.addExampleFromFile("alice", { file })).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("only reads the user's own resumes and refuses examples without enough text", async () => {
		await expect(style.addExampleFromResume("bob", { resumeId: "alice-cv" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			style.addExampleFromFile("alice", { file: new File(["Short text, but long enough to read."], "short.txt") }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});
