import type { CareerProfileData } from "@reactive-resume/schema/career";
import type { StructuredPreferences } from "@reactive-resume/schema/career-preferences";
import { describe, expect, it } from "vite-plus/test";
import { careerProfileDataSchema } from "@reactive-resume/schema/career";
import { structuredPreferencesSchema } from "@reactive-resume/schema/career-preferences";
import { chooseRule, compareEvaluations, evaluatePreferences } from "./evaluate";
import { readArrangements, readOfficeDays, readPostingTerms, readSalary } from "./posting";

const rule = (input: Record<string, unknown>) => ({
	places: [],
	country: null,
	radiusKm: null,
	preferredArrangement: null,
	preferredOfficeDays: null,
	maxOfficeDays: null,
	maxCommuteMinutes: null,
	relocation: false,
	priority: "must",
	salaryFloor: null,
	salaryPreferred: null,
	...input,
});

/** Lucas's own example: on-site fine at home, Toronto only remote, the rest of Canada remote. */
const structured = (extra: Partial<Record<keyof StructuredPreferences, unknown>> = {}) =>
	structuredPreferencesSchema.parse({
		locationRules: [
			rule({
				id: "ptbo",
				label: "Peterborough",
				scope: "places",
				places: ["Peterborough"],
				arrangements: ["onsite", "hybrid"],
				preferredArrangement: "hybrid",
			}),
			rule({
				id: "nearby",
				label: "Surrounding communities",
				scope: "places",
				places: ["Lindsay", "Cobourg", "Port Hope", "Peterborough County"],
				arrangements: ["hybrid", "remote"],
				maxOfficeDays: 2,
				priority: "strong",
			}),
			rule({
				id: "gta",
				label: "Greater Toronto Area",
				scope: "places",
				places: ["Toronto", "Mississauga", "Markham", "GTA"],
				arrangements: ["remote", "hybrid"],
				maxOfficeDays: 1,
				preferredArrangement: "remote",
			}),
			rule({ id: "canada", label: "Elsewhere in Canada", scope: "country", country: "CA", arrangements: ["remote"] }),
		],
		salary: { currency: "CAD", period: "year", floor: 70000, preferred: 95000, targetMin: 95000, targetMax: 120000 },
		...extra,
	});

const profile = (input: Partial<CareerProfileData> = {}): CareerProfileData =>
	careerProfileDataSchema.parse({ minBase: { amount: null, currency: "CAD", period: "year" }, ...input });

const post = (role: string, location: string, text: string) => ({ role, location, text });
const status = (evaluation: ReturnType<typeof evaluatePreferences>, key: string) =>
	evaluation.checks.find((check) => check.key === key)?.status;

describe("reading postings", () => {
	it("reads arrangements, office days and pay without guessing", () => {
		expect(readArrangements("This is a hybrid role, 3 days a week in the office.")).toEqual(["hybrid"]);
		expect(readArrangements("Fully remote within Canada.")).toEqual(["remote"]);
		expect(readArrangements("This is not a remote position; work is on-site.")).toEqual(["onsite"]);
		expect(readArrangements("Remote work available, with occasional on-site meetings.")).toEqual(["hybrid"]);
		expect(readArrangements("We build websites.")).toEqual([]);
		expect(readOfficeDays("Hybrid: two days per week in the office")).toBe(2);
		expect(readOfficeDays("3 days on-site")).toBe(3);
		expect(readOfficeDays("We have 3 offices")).toBeNull();

		expect(readSalary("Salary: $75,000 - $90,000 per year", "CAD")).toMatchObject({
			min: 75000,
			max: 90000,
			currency: "CAD",
			currencyAssumed: true,
			period: "year",
		});
		expect(readSalary("CAD 80K–95K", "CAD")).toMatchObject({
			min: 80000,
			max: 95000,
			currency: "CAD",
			period: "year",
			periodAssumed: true,
		});
		expect(readSalary("$32.50/hour", "CAD")).toMatchObject({ min: 32.5, period: "hour" });
		expect(readSalary("US$120,000 base plus commission", "CAD")).toMatchObject({
			currency: "USD",
			incomparable: "commission",
		});
		expect(readSalary("Manage a $5 budget", "CAD")).toBeNull();
		expect(readSalary("Competitive salary", "CAD")).toBeNull();
		expect(
			readPostingTerms({ text: "Permanent, full-time. Must relocate to Calgary.", location: "", userCurrency: "CAD" }),
		).toMatchObject({
			employment: ["permanent", "full-time"],
			relocationRequired: true,
		});
	});
});

describe("choosing a location rule", () => {
	const rules = structured().locationRules;
	it("prefers places in the location field, then places in the text, then country, then anywhere", () => {
		expect(chooseRule(rules, post("", "Peterborough, ON", ""))?.rule.id).toBe("ptbo");
		expect(chooseRule(rules, post("", "Toronto, ON", ""))?.rule.id).toBe("gta");
		expect(chooseRule(rules, post("", "", "Join our team in Cobourg."))?.rule.id).toBe("nearby");
		expect(chooseRule(rules, post("", "Vancouver, British Columbia, Canada", ""))?.rule.id).toBe("canada");
		expect(chooseRule(rules, post("", "Seattle, WA", ""))).toBeNull();
		// Overlap: "Peterborough County" names both a nearby place and Peterborough; list order decides.
		expect(chooseRule(rules, post("", "Peterborough County", ""))?.rule.id).toBe("ptbo");
		// A head office named deep in the text doesn't pick the rule.
		expect(chooseRule(rules, post("", "", `${"x".repeat(700)} Head office: Toronto`))).toBeNull();
	});
});

describe("evaluating roles", () => {
	it("accepts on-site in Peterborough but rules out on-site in Toronto", () => {
		const prefs = profile({ structured: structured() });
		const home = evaluatePreferences(
			prefs,
			post("Web Developer", "Peterborough, ON", "On-site role. $90,000–$100,000 per year."),
		);
		expect(home.verdict).toBe("fits");
		expect(home.rule).toEqual({ id: "ptbo", label: "Peterborough" });
		expect(status(home, "location:ptbo:arrangement")).toBe("met");
		expect(status(home, "location:ptbo:preferred-arrangement")).toBe("violated");

		const toronto = evaluatePreferences(
			prefs,
			post("Web Developer", "Toronto, ON", "This role is in-office five days. $110,000 per year."),
		);
		expect(toronto.verdict).toBe("conflict");
		expect(toronto.summary).toBe(
			"Doesn't meet 2 must-haves: Greater Toronto Area: remote or hybrid; Greater Toronto Area: at most 1 office day a week.",
		);
		const remote = evaluatePreferences(
			prefs,
			post("Web Developer", "Toronto, ON (Remote)", "Fully remote. $110,000 per year."),
		);
		expect(remote.verdict).toBe("fits");
	});

	it("treats a hybrid role with unstated office days as needing checking, not as a conflict", () => {
		const evaluation = evaluatePreferences(
			profile({ structured: structured() }),
			post("Developer", "Toronto", "Hybrid role. $100,000 a year."),
		);
		expect(status(evaluation, "location:gta:office-days")).toBe("unknown");
		expect(evaluation.verdict).toBe("check");
		expect(evaluation.summary).toMatch(/confirm Greater Toronto Area: at most 1 office day a week/);
	});

	it("flags missing or incomparable pay instead of rejecting", () => {
		const prefs = profile({ structured: structured() });
		const unlisted = evaluatePreferences(prefs, post("Developer", "Peterborough", "On-site. Competitive salary."));
		expect(status(unlisted, "salary:floor")).toBe("unknown");
		expect(unlisted.checks.find((check) => check.key === "salary:floor")?.detail).toBe("Salary not listed.");
		expect(unlisted.verdict).toBe("check");

		const hourly = evaluatePreferences(prefs, post("Developer", "Peterborough", "On-site. $38/hour."));
		expect(hourly.checks.find((check) => check.key === "salary:floor")?.detail).toBe(
			"Pay is per hour; your amounts are per year. It isn't converted.",
		);
		const usd = evaluatePreferences(prefs, post("Developer", "Vancouver, Canada", "Remote. USD 60,000 per year."));
		expect(usd.checks.find((check) => check.key === "salary:floor")?.status).toBe("unknown");
	});

	it("rules out pay below the absolute minimum, unless exceptions are allowed", () => {
		const low = post("Developer", "Peterborough", "On-site. $55,000 per year.");
		expect(evaluatePreferences(profile({ structured: structured() }), low).verdict).toBe("conflict");
		const flexible = structured({
			salary: {
				currency: "CAD",
				period: "year",
				floor: 70000,
				preferred: 95000,
				exceptions: ["mission", "flexibility"],
			},
		});
		const evaluation = evaluatePreferences(profile({ structured: flexible }), low);
		expect(evaluation.verdict).toBe("fits");
		const floor = evaluation.checks.find((check) => check.key === "salary:floor");
		expect(floor).toMatchObject({ priority: "strong", status: "violated" });
		expect(floor?.detail).toMatch(/You'd consider less for exceptional mission or flexibility\./);
	});

	it("uses location-specific pay when the rule sets it", () => {
		const base = structured();
		const withGta = {
			...base,
			locationRules: base.locationRules.map((item) => (item.id === "gta" ? { ...item, salaryFloor: 100000 } : item)),
		};
		const evaluation = evaluatePreferences(
			profile({ structured: withGta }),
			post("Dev", "Toronto (remote)", "Remote. $90,000 per year."),
		);
		expect(evaluation.checks.find((check) => check.key === "salary:floor")).toMatchObject({
			label: "Absolute minimum in Greater Toronto Area: CA$100,000 / year",
			status: "violated",
		});
	});

	it("evaluates the original settings as strong preferences, never as must-haves", () => {
		const legacy = profile({
			minBase: { amount: 95000, currency: "CAD", period: "year" },
			maxOfficeDays: 2,
			locations: ["Peterborough"],
		});
		const evaluation = evaluatePreferences(legacy, post("Developer", "Ottawa", "On-site. $60,000 per year."));
		expect(evaluation.verdict).toBe("fits");
		expect(evaluation.checks.map((check) => [check.key, check.priority, check.status, check.legacy])).toEqual([
			["legacy:office-days", "strong", "violated", true],
			["legacy:locations", "strong", "violated", true],
			["salary:preferred", "strong", "violated", true],
		]);
		expect(evaluation.summary).toMatch(/Misses 3 strong preferences/);
	});

	it("checks organization preferences, including employment types that exclude each other", () => {
		const prefs = profile({
			structured: structured({
				organization: [
					{ id: "type", kind: "employmentType", value: "permanent", priority: "must" },
					{ id: "np", kind: "organizationType", value: "nonprofit", priority: "strong" },
					{ id: "no-sales", kind: "other", value: "cold calling", stance: "avoid", priority: "strong" },
				],
			}),
		});
		const contract = evaluatePreferences(
			prefs,
			post("Developer", "Peterborough", "On-site, 12-month contract with a charity. $90,000 per year."),
		);
		expect(status(contract, "org:type")).toBe("violated");
		expect(status(contract, "org:np")).toBe("met");
		expect(status(contract, "org:no-sales")).toBe("unknown");
		expect(contract.verdict).toBe("conflict");
		const unstated = evaluatePreferences(
			prefs,
			post("Developer", "Peterborough", "On-site. $90,000 per year. Some cold calling."),
		);
		expect(status(unstated, "org:type")).toBe("unknown");
		expect(status(unstated, "org:no-sales")).toBe("violated");
	});

	it("lets the user set a preference aside for one role", () => {
		const prefs = profile({ structured: structured() });
		const toronto = post("Developer", "Toronto", "In-office role. $110,000 per year.");
		const overridden = evaluatePreferences(
			prefs,
			toronto,
			new Set(["location:gta:arrangement", "location:gta:office-days"]),
		);
		expect(overridden.verdict).toBe("fits");
		expect(status(overridden, "location:gta:arrangement")).toBe("overridden");
	});

	it("ranks by verdict, then strong preferences, then nice-to-haves", () => {
		const prefs = profile({ structured: structured(), targetRoles: ["Web Developer"] });
		const fitsWell = evaluatePreferences(
			prefs,
			post("Web Developer", "Peterborough", "Hybrid, 2 days in office. $100,000 per year."),
		);
		const fitsLess = evaluatePreferences(prefs, post("Analyst", "Peterborough", "On-site. $80,000 per year."));
		const unclear = evaluatePreferences(prefs, post("Web Developer", "Peterborough", "On-site."));
		const conflict = evaluatePreferences(prefs, post("Web Developer", "Toronto", "On-site. $130,000 per year."));
		const ranked = [conflict, unclear, fitsLess, fitsWell].toSorted(compareEvaluations);
		expect(ranked).toEqual([fitsWell, fitsLess, unclear, conflict]);
	});
});
