import { expect, test } from "../fixtures/test";

test("the site's root opens the login page when signed out", async ({ page }) => {
	await page.goto("/");
	await page.waitForURL(/\/auth\/login/);
	await expect(page.getByRole("button", { name: /sign in/i }).first()).toBeVisible();
});

test("the site's root opens the dashboard when signed in", async ({ authPage: page }) => {
	await page.goto("/");
	await page.waitForURL(/\/dashboard/);
	await expect(page).not.toHaveURL(/\/auth\//);
	// Following a link back to the root from inside the app also lands on the dashboard.
	await page.getByRole("link", { name: "Countdown Creative" }).first().click();
	await expect(page).toHaveURL(/\/dashboard/);
});
