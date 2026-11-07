import { expect, test } from "../fixtures/test";

test("a new preset is added from a labelled template picker", async ({ authPage: page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/dashboard/settings/resume-style");
	const picker = page.getByLabel("New preset from");
	await expect(picker).toBeVisible();
	await expect(page.getByRole("tab")).toHaveCount(1);
	const box = await picker.boundingBox();
	const button = await page.getByRole("button", { name: "Add preset" }).boundingBox();
	// The picker and the button sit side by side without overlapping.
	expect(box && button && box.x + box.width <= button.x).toBe(true);
	if (process.env.E2E_SCREENSHOTS)
		await page.screenshot({
			path: `${process.env.E2E_SCREENSHOTS}/style.png`,
			clip: { x: 240, y: 0, width: 1040, height: 360 },
		});
	await picker.selectOption({ label: "Communications" });
	await page.getByRole("button", { name: "Add preset" }).click();
	await expect(page.getByRole("tab")).toHaveCount(2);
	await expect(page.getByRole("tab", { name: /Communications/ })).toBeVisible();
});
