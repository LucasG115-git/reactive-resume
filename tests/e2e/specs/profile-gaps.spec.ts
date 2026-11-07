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

test("before tailoring, the posting's missing skills and experience can be added to the profile", async ({
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
	const entryId = (await entry.json()).id;
	await page.request.post("/api/openapi/master-profile/achievements", {
		data: { entryId, text: "Delivered WordPress sites for 12 nonprofits on schedule" },
	});
	const applicationId = (await (
		await page.request.post("/api/openapi/applications", {
			data: {
				company: "Lumen",
				role: "Digital Project Manager",
				status: "saved",
				jobDescription: "We need a WordPress expert for nonprofit web projects.",
			},
		})
	).json()) as string;

	await page.goto(`/dashboard/applications?applicationId=${applicationId}`);
	await page.getByRole("button", { name: "Assemble from profile" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Analyse the posting" }).click();

	await expect(dialog.getByRole("heading", { name: "Fill the gaps in your profile" })).toBeVisible({ timeout: 30_000 });
	await expect(dialog.getByText(/% match for this posting/)).toBeVisible();
	await expect(dialog.getByText("Judged by your AI connection, requirement by requirement")).toBeVisible();
	await dialog.getByText("How this is worked out").click();
	await expect(dialog.getByText("Delivered WordPress sites.")).toBeVisible();
	// WordPress is already in the profile (named in an achievement), so only the new skills are asked about.
	await expect(dialog.getByRole("checkbox", { name: /WordPress/ })).toHaveCount(0);
	const photography = dialog.getByRole("listitem").filter({ hasText: "Skilled in photography" });
	await photography.getByRole("checkbox", { name: /^Photography/ }).check();
	// A skill can be tied to every place it was used.
	await photography.getByRole("button", { name: "Founder — Northbrook Digital" }).click();
	await expect(photography.getByRole("button", { name: "Founder — Northbrook Digital" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	const printers = dialog.getByRole("listitem").filter({ hasText: "Plan Open House events" });
	await printers.getByRole("radio", { name: "I've done this" }).click();
	await printers.getByLabel("Where did you do it?").selectOption({ label: "Founder — Northbrook Digital" });
	await printers.getByLabel("What you did").fill("I planned two open house events for a nonprofit");
	await printers.getByRole("button", { name: "Turn it into a resume line" }).click();
	await expect(printers.getByLabel("Line to add to your profile")).toHaveValue(
		"Planned two open house events for a nonprofit",
	);
	if (process.env.E2E_SCREENSHOTS) await dialog.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/gaps.png` });
	await dialog.getByRole("button", { name: "Save to profile and continue" }).click();

	await expect(dialog.getByRole("heading", { name: "Choose what to include" })).toBeVisible({ timeout: 30_000 });
	const profile = await (await page.request.get("/api/openapi/master-profile")).json();
	expect(profile.skills).toContainEqual(
		expect.objectContaining({ name: "Photography", kind: "skill", entryIds: [entryId] }),
	);
	expect(JSON.stringify(profile.entries)).toContain("Planned two open house events for a nonprofit");
	// The new achievement is now part of the proposal.
	await expect(dialog.getByText("Planned two open house events for a nonprofit")).toBeVisible();
});
