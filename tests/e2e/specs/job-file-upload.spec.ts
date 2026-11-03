import { startAiStub } from "../fixtures/ai-stub";
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

const POSTING =
	"Communications Manager. Harbourview Food Bank (fictional), Peterborough, ON. Salary $68,000 to $74,000. Plan donor email campaigns and write our newsletters.";

test("an uploaded posting file shows it was read and fills the role, company, location and salary", async ({
	authPage: page,
	browser,
}) => {
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

	// A real PDF with a text layer, printed by the browser.
	const printer = await browser.newPage();
	await printer.setContent(`<p>${POSTING}</p>`);
	const pdf = await printer.pdf();
	await printer.close();

	for (const file of [
		{ name: "posting.pdf", mimeType: "application/pdf", buffer: pdf },
		{ name: "posting.txt", mimeType: "text/plain", buffer: Buffer.from(POSTING) },
	]) {
		await page.goto("/dashboard/applications?create=true");
		const dialog = page.getByRole("dialog");
		await dialog.locator('input[type="file"]').setInputFiles(file);
		await expect(dialog.getByText(file.name, { exact: true })).toBeVisible();
		await expect(dialog.getByText("Uploaded and read")).toBeVisible({ timeout: 30_000 });
		await expect(dialog.getByLabel("Job link or posting text")).toHaveValue(/Harbourview Food Bank/);
		await expect(dialog.getByLabel("Role", { exact: true })).toHaveValue("Communications Manager");
		await expect(dialog.getByLabel("Company", { exact: true })).toHaveValue("Harbourview Food Bank");
		await expect(dialog.getByLabel("Location", { exact: true })).toHaveValue("Peterborough, ON");
		await expect(dialog.getByLabel("Salary", { exact: true })).toHaveValue("$68,000–$74,000");
		if (process.env.E2E_SCREENSHOTS && file.name.endsWith(".pdf"))
			await dialog.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/upload.png` });
	}

	// Pasted text fills the fields without pressing anything.
	await page.goto("/dashboard/applications?create=true");
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Job link or posting text").fill(POSTING);
	await expect(dialog.getByLabel("Role", { exact: true })).toHaveValue("Communications Manager", { timeout: 15_000 });
	await expect(dialog.getByLabel("Salary", { exact: true })).toHaveValue("$68,000–$74,000");

	// An unreadable file says so.
	await page.goto("/dashboard/applications?create=true");
	await page
		.getByRole("dialog")
		.locator('input[type="file"]')
		.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
	await expect(page.getByRole("dialog").getByText("Couldn't read")).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
});
