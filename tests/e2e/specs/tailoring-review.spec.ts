import { REVIEWER_PREFIX, startAiStub } from "../fixtures/ai-stub";
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

test("an assembled resume is reviewed once, its draft wording can be put back, and feedback is kept", async ({
	authPage: page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1280, height: 1100 });
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

	const entry = await page.request.post("/api/openapi/master-profile/entries", {
		data: { kind: "position", organization: "Northbrook Digital", title: "Founder", startDate: "2019-03" },
	});
	await expect(entry).toBeOK();
	const entryId = (await entry.json()).id;
	const bullets = [
		"Delivered WordPress sites for 12 nonprofits on schedule",
		"Rebuilt a nonprofit volunteer portal on WordPress, cutting admin time by 40%",
	];
	for (const text of bullets)
		await expect(
			await page.request.post("/api/openapi/master-profile/achievements", { data: { entryId, text } }),
		).toBeOK();
	const created = await page.request.post("/api/openapi/applications", {
		data: {
			company: "Lumen",
			role: "Digital Project Manager",
			status: "saved",
			jobDescription: "We need a WordPress expert who manages nonprofit web projects.",
		},
	});
	await expect(created).toBeOK();
	const applicationId = (await created.json()) as string;

	await page.goto(`/dashboard/applications?applicationId=${applicationId}`);
	await page.getByRole("button", { name: "Assemble from profile" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Analyse the posting" }).click();
	// The posting asks for things the profile doesn't show; this test skips adding them.
	await dialog.getByRole("button", { name: "Skip for now" }).click({ timeout: 30_000 });
	await dialog.getByRole("button", { name: "Next: build the resume" }).click({ timeout: 30_000 });
	await expect(dialog.getByRole("switch", { name: /Review the draft with AI/ })).toBeChecked();
	await dialog.getByRole("button", { name: "Assemble resume" }).click();

	await expect(dialog.getByText("AI review · 8 out of 10")).toBeVisible({ timeout: 60_000 });
	await expect(dialog.getByText("Changed by the reviewer")).toBeVisible();
	await expect(dialog.getByText("Mention the nonprofit focus earlier.")).toBeVisible();
	await expect(dialog.getByText(/^PDF: 1 page · 100% of lines read back/)).toBeVisible();
	await expect(dialog.getByText("Word: 100% of lines read back")).toBeVisible();
	await expect(dialog.getByText("Models used")).toBeVisible();

	const resumeText = async () => {
		const application = await (await page.request.get(`/api/openapi/applications/${applicationId}`)).json();
		return JSON.stringify(await (await page.request.get(`/api/openapi/resumes/${application.resumeId}`)).json());
	};
	expect(await resumeText()).toContain(REVIEWER_PREFIX);
	await dialog.getByRole("button", { name: "Use the draft wording" }).click();
	await expect(dialog.getByText("Put back to the draft wording")).toBeVisible();
	expect(await resumeText()).not.toContain(REVIEWER_PREFIX);
	if (process.env.E2E_SCREENSHOTS) await dialog.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/review.png` });

	await dialog.getByRole("button", { name: "Close" }).first().click();
	await page.getByRole("button", { name: /Rate it and learn from your edits/ }).click();
	await page.getByRole("radio", { name: "Good" }).click();
	await page.getByLabel("What to do differently").fill("Lead with results");
	await page.getByRole("button", { name: "Send feedback" }).click();
	await expect(page.getByText("Thanks. Later resumes will follow your feedback.")).toBeVisible();
	const feedback = await (
		await page.request.get(`/api/openapi/master-profile/feedback?applicationId=${applicationId}`)
	).json();
	expect(feedback).toEqual([expect.objectContaining({ rating: "good", note: "Lead with results", corrections: [] })]);
});
