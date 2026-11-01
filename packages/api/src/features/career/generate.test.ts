import { describe, expect, it } from "vite-plus/test";
import { stripQuoted } from "./generate";

describe("pasted employer messages", () => {
	it("preserves a full email's current body and removes later quoted headers", () => {
		expect(
			stripQuoted(
				"From: Recruiter <recruiter@example.test>\nSent: Tuesday\nTo: Alice\nSubject: Invitation\n\nCan you do Tuesday?\n\nFrom: Alice\nOld message",
			),
		).toBe("Can you do Tuesday?");
	});
	it("returns no body for headers alone", () => {
		expect(stripQuoted("From: Recruiter\nSubject: Invitation")).toBe("");
	});
	it.each([
		["a signature", "Can you do Tuesday?\n\n-- \nMaya Example\nRecruiter, ACME"],
		[
			"quoted history",
			"Can you do Tuesday?\n\nOn Mon, 5 Oct 2026 at 10:00, Alice <alice@example.test> wrote:\n> My notes",
		],
		[
			"a forwarded header",
			"Can you do Tuesday?\r\n> Earlier line\r\nFrom: Maya Example <maya@acme.test>\r\nSent: Monday",
		],
	])("drops %s before the message is sent to the model", (_, message) => {
		expect(stripQuoted(message)).toBe("Can you do Tuesday?");
	});
});

describe("fact relevance", () => {
	it("puts facts sharing the most terms with the request first, keeping ties in order", async () => {
		const { rankByRelevance, terms } = await import("./generate");
		expect([...terms("Managing WordPress sites and the PHP services")]).toEqual([
			"manag",
			"wordpress",
			"site",
			"php",
			"service",
		]);
		const facts = [
			{ id: "a", text: "Ran a bakery shift" },
			{ id: "b", text: "Built WordPress membership sites" },
			{ id: "c", text: "Wrote PHP for WordPress membership services" },
			{ id: "d", text: "Organized events" },
		];
		expect(
			rankByRelevance(facts, "We need a WordPress developer for membership services in PHP").map((fact) => fact.id),
		).toEqual(["c", "b", "a", "d"]);
		expect(rankByRelevance(facts, "").map((fact) => fact.id)).toEqual(["a", "b", "c", "d"]);
	});
});
