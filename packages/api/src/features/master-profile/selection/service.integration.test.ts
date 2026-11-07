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
// Assembling renders and reads back a real PDF and DOCX, which takes a few seconds under load.
describe.skipIf(!databaseUrl)("resume selection plans", { timeout: 30_000 }, () => {
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
		expect(built.result.writing?.style).toEqual({ presetId: "general", name: "General" });

		const reset = await selection.reset("alice", "alice-app");
		expect(reset?.plan.totals.includedEntries).toBe(1);
	});

	it("keeps task model settings, uses the saved quality and records each step's usage", async () => {
		await seedProfile();
		const { aiTasksService } = await import("../../ai-tasks/service");
		const defaults = await aiTasksService.get("alice");
		expect(defaults.quality).toBe("standard");
		const saved = await aiTasksService.save("alice", {
			...defaults,
			quality: "thorough",
			tasks: { ...defaults.tasks, writing: { ...defaults.tasks.writing, model: "writer-model" } },
			thorough: { ...defaults.thorough, model: "deep-model", reasoningEffort: "high" },
		});
		expect((await aiTasksService.get("alice")).thorough.model).toBe("deep-model");
		expect(saved.tasks.extraction.model).toBeNull();
		expect((await aiTasksService.get("bob")).thorough.model).toBeNull();

		const seen: Array<[string, string | undefined]> = [];
		const counted: AskModel = async (input) => {
			seen.push([input.task, input.quality]);
			const answer = await ask(input);
			if (input.task === "writing") return { model: "stub/write", output: input.schema.parse({}) };
			return { ...answer, usage: { inputTokens: 100, outputTokens: 20 } };
		};
		const proposed = await selection.propose(
			"alice",
			{ applicationId: "alice-app", quality: "thorough" },
			{ ask: counted },
		);
		expect(seen).toEqual([
			["extraction", "thorough"],
			["evidence", "thorough"],
		]);
		expect(proposed?.plan.usage.map((item) => [item.step, item.task, item.inputTokens])).toEqual([
			["analysis", "extraction", 100],
			["review", "evidence", 100],
		]);

		// No quality in the request: the saved default (Thorough) is used for writing.
		seen.length = 0;
		const built = await assemble.assemble("alice", { applicationId: "alice-app", mode: "rephrase" }, { ask: counted });
		// Writing, then the review, then the summary last (an empty answer is retried once, then left out).
		expect(seen).toEqual([
			["writing", "thorough"],
			["review", "thorough"],
			["writing", "thorough"],
			["writing", "thorough"],
		]);
		expect(built.result.writing?.quality).toBe("thorough");
		expect(built.result.writing?.usage.map((item) => [item.step, item.model])).toEqual([
			["writing", "stub/write"],
			["review", "stub/review"],
			["summary", "stub/write"],
			["summary", "stub/write"],
		]);
	});

	it("reviews the draft once, keeps its wording to put back, and learns style from edits without touching facts", async () => {
		const seeded = await seedProfile();
		await selection.propose("alice", { applicationId: "alice-app" }, { ask });
		const sitesText = "Delivered WordPress sites for 12 nonprofits on schedule";
		const reviewer: AskModel = async (input) => {
			if (input.task !== "review") return ask(input);
			const key = [...input.prompt.matchAll(/^\s+(B\d+): (.+)$/gm)].find(([, , text]) => text === sitesText)?.[1];
			return {
				model: "stub/reviewer",
				output: input.schema.parse({
					score: 6,
					findings: [
						{
							category: "strength",
							severity: "high",
							message: "Lead with the scale.",
							ref: key,
							rewrite: "Delivered 12 WordPress sites for nonprofits on schedule",
							changesClaim: false,
						},
						{
							category: "accuracy",
							severity: "medium",
							message: "Name the budget.",
							ref: key,
							rewrite: "Delivered 12 WordPress sites for nonprofits under a $90,000 budget",
							changesClaim: false,
						},
					],
				}),
			};
		};
		const built = await assemble.assemble(
			"alice",
			{ applicationId: "alice-app", mode: "rephrase" },
			{
				ask: reviewer,
				renderers: {
					pdf: async () => Promise.reject(new Error("skipped")),
					docx: async () => Promise.reject(new Error("skipped")),
				},
			},
		);
		const review = built.result.writing?.review;
		expect(review?.score).toBe(6);
		expect(review?.revisions).toEqual([
			expect.objectContaining({ achievementId: seeded.sites.id, before: sitesText, status: "applied" }),
		]);
		expect(built.result.writing?.rendering?.errors).toHaveLength(2);
		const html = async () =>
			JSON.stringify((await getDb().select().from(tables.resume).where(eq(tables.resume.id, built.resumeId)))[0]?.data);
		expect(await html()).toContain("Delivered 12 WordPress sites for nonprofits on schedule");

		const { revisionService } = await import("../assemble/revisions");
		const reverted = await revisionService.update("alice", {
			assemblyId: built.assemblyId,
			index: 0,
			action: "revert",
		});
		expect(reverted.writing?.review?.revisions[0]?.status).toBe("reverted");
		expect(await html()).toContain(sitesText);
		await expect(
			revisionService.update("bob", { assemblyId: built.assemblyId, index: 0, action: "apply" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await revisionService.update("alice", { assemblyId: built.assemblyId, index: 0, action: "apply" });
		expect(await html()).not.toContain(sitesText);

		// The user edits a bullet in the editor; feedback records it as a preference.
		const [row] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, built.resumeId));
		const edited = JSON.parse(
			JSON.stringify(row?.data).replace(
				"Rebuilt a nonprofit volunteer portal on WordPress, cutting admin time by 40%",
				"Rebuilt a WordPress volunteer portal for a nonprofit, cutting admin time by 40%",
			),
		);
		await getDb().update(tables.resume).set({ data: edited }).where(eq(tables.resume.id, built.resumeId));
		const { feedbackService } = await import("../feedback");
		const feedback = await feedbackService.submit("alice", {
			assemblyId: built.assemblyId,
			rating: "needs-work",
			note: "Put the platform first",
			learnFromEdits: true,
		});
		expect(feedback.corrections).toEqual([
			expect.objectContaining({
				target: "bullet",
				achievementId: seeded.portal.id,
				edited: "Rebuilt a WordPress volunteer portal for a nonprofit, cutting admin time by 40%",
			}),
		]);
		expect(await feedbackService.list("bob")).toEqual([]);
		const [portal] = await getDb()
			.select()
			.from(tables.profileAchievement)
			.where(eq(tables.profileAchievement.id, seeded.portal.id));
		expect(portal?.text).toBe("Rebuilt a nonprofit volunteer portal on WordPress, cutting admin time by 40%");

		// The next resume's writer sees it as feedback.
		const prompts: string[] = [];
		await assemble.assemble(
			"alice",
			{ applicationId: "alice-app", mode: "rephrase", review: false },
			{
				ask: async (input) => {
					if (input.task === "writing") prompts.push(input.prompt);
					return ask(input);
				},
				renderers: {
					pdf: async () => Promise.reject(new Error("skipped")),
					docx: async () => Promise.reject(new Error("skipped")),
				},
			},
		);
		expect(prompts[0]).toContain("USER_FEEDBACK");
		expect(prompts[0]).toContain("Put the platform first");
		await feedbackService.delete("alice", feedback.id);
		expect(await feedbackService.list("alice")).toEqual([]);
	});

	it("reports what the profile lacks, adds what the user confirms, and proposes again from the larger profile", async () => {
		const seeded = await seedProfile();
		await selection.propose("alice", { applicationId: "alice-app" }, { ask });
		const { gapsService } = await import("./gaps-service");
		const before = await gapsService.get("alice", "alice-app");
		expect(before?.match).toBeLessThan(100);
		const french = before?.gaps.find((gap) => gap.text === "French fluency");
		expect(french).toMatchObject({ answer: null });
		expect(await gapsService.get("bob", "alice-app")).toBeNull();

		const drafted = await gapsService.draft(
			"alice",
			{
				applicationId: "alice-app",
				requirementId: french?.requirementId ?? "",
				entryId: seeded.founder.id,
				note: "I ran client meetings in French for two Quebec nonprofits",
			},
			{
				ask: async ({ schema }) => ({
					model: "stub",
					output: schema.parse({ text: "Led client meetings in French for 12 Quebec nonprofits" }),
				}),
			},
		);
		// The draft added a number the note didn't state, so the user's own words come back.
		expect(drafted.text).toBe("I ran client meetings in French for two Quebec nonprofits");
		expect(drafted.warning).toMatch(/introduced number 12/);

		const answered = await gapsService.answer(
			"alice",
			{
				applicationId: "alice-app",
				answers: [
					{
						requirementId: french?.requirementId ?? "",
						have: true,
						skills: ["French"],
						entryId: seeded.founder.id,
						text: "Ran client meetings in French for two Quebec nonprofits",
					},
				],
			},
			{ ask },
		);
		expect(answered.added).toBe(2);
		const saved = await profile.get("alice");
		expect(saved.skills.map((skill) => skill.name)).toContain("French");
		const founder = saved.entries.find((entry) => entry.id === seeded.founder.id);
		expect(founder?.achievements.map((item) => item.text)).toContain(
			"Ran client meetings in French for two Quebec nonprofits",
		);
		expect(answered.report?.gaps.find((gap) => gap.requirementId === french?.requirementId)?.answer ?? "added").toBe(
			"added",
		);
		expect(answered.report?.match).toBeGreaterThan(before?.match ?? 0);
		expect((await profile.get("bob")).skills.map((skill) => skill.name)).not.toContain("French");

		// A "no" is remembered for this posting and adds nothing.
		const declined = await gapsService.answer("alice", {
			applicationId: "alice-app",
			answers: [{ requirementId: french?.requirementId ?? "", have: false, skills: [], entryId: null, text: "" }],
		});
		expect(declined.added).toBe(0);
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
