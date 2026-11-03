import { startAiStub, UNKNOWN_MODEL } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

// The stub is a local provider, so the server must allow a loopback base URL.
test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

test("sets a model per task, checks each one, and keeps Thorough opt-in", async ({ authPage: page }) => {
	test.setTimeout(90_000);
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Demo connection",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(provider).toBeOK();
	await expect(await page.request.post(`/api/openapi/ai-providers/${(await provider.json()).id}/test`)).toBeOK();

	await page.goto("/dashboard/settings/ai");
	const section = page.getByRole("region", { name: "Models for each task" });
	await expect(section.getByRole("heading", { name: "Writing resumes" })).toBeVisible();
	// Blank settings show the default connection's model and leave Thorough unavailable.
	await expect(section.getByLabel("Model for Writing resumes")).toHaveAttribute("placeholder", "stub");
	await expect(section.getByRole("radio", { name: "Thorough" })).toBeDisabled();

	await section.getByLabel("Model for Writing resumes").fill("stub-writer");
	await section.getByLabel("Model for Reading postings").fill(UNKNOWN_MODEL);
	await section.getByLabel("Model for Thorough model").fill("stub-deep");
	await section.getByLabel("Reasoning effort for Thorough model").selectOption("high");
	await expect(section.getByText("Save, then check this model.").first()).toBeVisible();
	await section.getByRole("button", { name: "Save models" }).click();
	await expect(section.getByRole("button", { name: "Save models" })).toBeDisabled();

	const rows = section.getByRole("listitem");
	const writing = rows.filter({ has: page.getByRole("heading", { name: "Writing resumes" }) });
	await writing.getByRole("button", { name: "Check" }).click();
	await expect(writing.getByText("JSON works")).toBeVisible({ timeout: 20_000 });
	await expect(writing.getByText("tool calls work")).toBeVisible();

	const reading = rows.filter({ has: page.getByRole("heading", { name: "Reading postings" }) });
	await reading.getByRole("button", { name: "Check" }).click();
	await expect(reading.getByText("JSON failed")).toBeVisible({ timeout: 20_000 });

	// A Thorough model makes Thorough selectable; the default stays Standard until chosen.
	await expect(section.getByRole("radio", { name: "Thorough" })).toBeEnabled();
	await expect(section.getByRole("radio", { name: "Standard" })).toBeChecked();

	const saved = await (await page.request.get("/api/openapi/ai-tasks")).json();
	expect(saved.quality).toBe("standard");
	expect(saved.tasks.writing).toMatchObject({ model: "stub-writer", lastTest: { ok: true, json: true, tools: true } });
	expect(saved.tasks.extraction).toMatchObject({ model: UNKNOWN_MODEL, lastTest: { ok: false } });
	expect(saved.thorough).toMatchObject({ model: "stub-deep", reasoningEffort: "high" });
	// Checks call the provider with the configured model name.
	expect(stub.requests.some((request) => request.model === "stub-writer")).toBe(true);
});
