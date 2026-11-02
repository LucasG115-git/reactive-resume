import type { PostingSalary, PostingTerms } from "./posting";
import type { CareerProfileData } from "@reactive-resume/schema/career";
import type {
	LocationRule,
	OrganizationPreference,
	PreferenceCheck,
	PreferenceEvaluation,
	PreferencePriority,
	SalaryPreference,
	WorkArrangement,
} from "@reactive-resume/schema/career-preferences";
import { EMPTY_STRUCTURED_PREFERENCES } from "@reactive-resume/schema/career-preferences";
import { matchOpportunity } from "../career/matching";
import { readPostingTerms } from "./posting";

const officeDayCount = (days: number | null) => (days === 1 ? "1 office day" : `${days} office days`);
/**
 * Checks a role against the user's preferences and explains the result. Deterministic and conservative:
 * - Only a must-have the posting confirms is unmet makes a "conflict". Missing information is "unknown", never a no.
 * - The original settings (minimum salary, maximum office days, places) count as strong preferences, never
 *   must-haves, until the user sets structured preferences.
 * - Pay is compared only in the same currency and period; anything else is flagged, not converted.
 * - The user can set any preference aside for one application ("overridden").
 */

export type Posting = { role: string; location: string; text: string };

const ARRANGEMENT_LABEL: Record<WorkArrangement, string> = { onsite: "on-site", hybrid: "hybrid", remote: "remote" };
const list = (items: string[]) =>
	items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

/** Items in a summary sentence: labels can contain "or" themselves, so they're separated by semicolons. */
const listAll = (items: string[]) => items.join("; ");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole-word, case-insensitive mention of a place or phrase. */
const mentions = (text: string, phrase: string) =>
	phrase.trim() !== "" &&
	new RegExp(String.raw`(?<![\p{L}\p{N}])${escape(phrase.trim())}(?![\p{L}\p{N}])`, "iu").test(text);

const countryNames = (code: string) => {
	const names = new Set<string>();
	for (const locale of ["en", "fr", "de", "es"]) {
		const name = new Intl.DisplayNames([locale], { type: "region" }).of(code);
		if (name && name !== code) names.add(name);
	}
	if (code === "US") ["USA", "United States of America", "U.S."].forEach((name) => names.add(name));
	if (code === "GB") ["UK", "Britain", "England", "Scotland", "Wales"].forEach((name) => names.add(name));
	return [...names];
};

export type RuleChoice = { rule: LocationRule; why: string } | null;

/**
 * The rule for a posting. Specificity decides: a rule whose places appear in the posting's location, then one
 * whose places appear in its text, then a country rule, then an "anywhere" rule. Among equals, list order decides.
 */
export function chooseRule(rules: LocationRule[], posting: Pick<Posting, "location" | "text">): RuleChoice {
	const places = rules.filter((rule) => rule.scope === "places");
	for (const rule of places) {
		const place = rule.places.find((name) => mentions(posting.location, name));
		if (place) return { rule, why: `${place} is in the posting's location` };
	}
	// Only the opening of the text: postings often name a head office or other sites further down.
	const opening = posting.text.slice(0, 600);
	for (const rule of places) {
		const place = rule.places.find((name) => mentions(opening, name));
		if (place) return { rule, why: `the posting mentions ${place}` };
	}
	for (const rule of rules.filter((rule) => rule.scope === "country" && rule.country)) {
		const name = countryNames(rule.country ?? "").find(
			(country) => mentions(posting.location, country) || mentions(opening, country),
		);
		if (name) return { rule, why: `the posting is in ${name}` };
	}
	const anywhere = rules.find((rule) => rule.scope === "anywhere");
	return anywhere ? { rule: anywhere, why: "no more specific rule covers it" } : null;
}

type Draft = Omit<PreferenceCheck, "legacy"> & { legacy?: boolean };

function locationChecks(
	rules: LocationRule[],
	posting: Posting,
	terms: PostingTerms,
	legacy: boolean,
): { checks: Draft[]; rule: LocationRule | null } {
	const choice = chooseRule(rules, posting);
	const arrangements = terms.arrangements;
	const stated = list(arrangements.map((arrangement) => ARRANGEMENT_LABEL[arrangement]));
	if (!choice) {
		const where = posting.location.trim();
		return {
			rule: null,
			checks: [
				{
					key: "location:none",
					label: "In an area you've set rules for",
					priority: "strong",
					status: where ? "violated" : "unknown",
					detail: where
						? `${where} isn't in any area you've set rules for.`
						: "The posting doesn't say where the work is.",
				},
			],
		};
	}
	const { rule, why } = choice;
	const prefix = `location:${rule.id}`;
	const checks: Draft[] = [];
	const allowed = list(rule.arrangements.map((arrangement) => ARRANGEMENT_LABEL[arrangement]));
	const fits = arrangements.some((arrangement) => rule.arrangements.includes(arrangement));
	if (rule.arrangements.length < 3)
		checks.push({
			key: `${prefix}:arrangement`,
			label: `${rule.label}: ${allowed}`,
			priority: rule.priority,
			status: arrangements.length === 0 ? "unknown" : fits ? "met" : "violated",
			detail:
				arrangements.length === 0
					? `The posting doesn't say whether it's on-site, hybrid or remote (${rule.label} rule, as ${why}).`
					: fits
						? `The posting says ${stated}, which you accept in ${rule.label}.`
						: `The posting says ${stated}; in ${rule.label} you accept ${allowed} (applies as ${why}).`,
			legacy,
		});

	// On-site with no stated days means a full week; fully remote means none.
	const only = arrangements.length === 1 ? arrangements[0] : undefined;
	const days = terms.officeDays ?? (only === "onsite" ? 5 : only === "remote" ? 0 : null);
	const daysText =
		terms.officeDays === null && days !== null
			? `${only === "onsite" ? "on-site" : "remote"}, so ${officeDayCount(days)}`
			: officeDayCount(days);
	if (rule.maxOfficeDays !== null)
		checks.push({
			key: `${prefix}:office-days`,
			label: `${rule.label}: at most ${officeDayCount(rule.maxOfficeDays)} a week`,
			priority: rule.priority,
			status: days === null ? "unknown" : days <= rule.maxOfficeDays ? "met" : "violated",
			detail:
				days === null
					? "The posting doesn't say how many days are in the office."
					: `The posting means ${daysText} a week.`,
			legacy,
		});
	if (rule.preferredArrangement)
		checks.push({
			key: `${prefix}:preferred-arrangement`,
			label: `${rule.label}: ${ARRANGEMENT_LABEL[rule.preferredArrangement]} preferred`,
			priority: "nice",
			status:
				arrangements.length === 0 ? "unknown" : arrangements.includes(rule.preferredArrangement) ? "met" : "violated",
			detail: arrangements.length === 0 ? "Arrangement not stated." : `The posting says ${stated}.`,
		});
	if (rule.preferredOfficeDays !== null)
		checks.push({
			key: `${prefix}:preferred-office-days`,
			label: `${rule.label}: ${officeDayCount(rule.preferredOfficeDays)} a week or fewer preferred`,
			priority: "nice",
			status: days === null ? "unknown" : days <= rule.preferredOfficeDays ? "met" : "violated",
			detail: days === null ? "Office days not stated." : `The posting means ${daysText} a week.`,
		});
	if (terms.relocationRequired && !rule.relocation)
		checks.push({
			key: `${prefix}:relocation`,
			label: `${rule.label}: no relocation`,
			priority: rule.priority,
			status: "violated",
			detail: "The posting requires relocating, which you haven't accepted for this area.",
		});
	return { checks, rule };
}

function compareSalary(
	salary: PostingSalary | null,
	currency: string,
	period: SalaryPreference["period"],
): { ok: true; note: string } | { ok: false; detail: string } {
	if (!salary) return { ok: false, detail: "Salary not listed." };
	if (salary.incomparable)
		return { ok: false, detail: `Pay includes ${salary.incomparable}, which isn't comparable with a base salary.` };
	if (!salary.currency) return { ok: false, detail: "The posting's currency isn't stated." };
	if (salary.currency !== currency)
		return { ok: false, detail: `Pay is in ${salary.currency}; your amounts are in ${currency}. It isn't converted.` };
	if (!salary.period) return { ok: false, detail: "The posting doesn't say whether pay is hourly, monthly or yearly." };
	if (salary.period !== period)
		return { ok: false, detail: `Pay is per ${salary.period}; your amounts are per ${period}. It isn't converted.` };
	const assumed = [
		salary.currencyAssumed ? `read "$" as ${currency}` : "",
		salary.periodAssumed ? "read as yearly" : "",
	].filter(Boolean);
	return { ok: true, note: assumed.length ? ` (${assumed.join(", ")})` : "" };
}

const money = (amount: number, currency: string) =>
	new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

function salaryChecks(
	preference: SalaryPreference,
	rule: LocationRule | null,
	terms: PostingTerms,
	legacy: boolean,
): Draft[] {
	const { currency, period } = preference;
	const posting = terms.salary;
	const compared = compareSalary(posting, currency, period);
	const range = posting
		? `${money(posting.min, posting.currency ?? currency)}${posting.max > posting.min ? `–${money(posting.max, posting.currency ?? currency)}` : ""}`
		: "";
	const checks: Draft[] = [];

	const threshold = (key: string, label: string, priority: PreferencePriority, amount: number, extra = ""): Draft => {
		const base = { key, label: `${label}: ${money(amount, currency)} / ${period}`, priority, legacy };
		if (!compared.ok || !posting)
			return { ...base, status: "unknown", detail: (compared.ok ? "" : compared.detail) + extra };
		if (posting.min >= amount)
			return { ...base, status: "met", detail: `The posting offers ${range}${compared.note}.${extra}` };
		if (posting.max < amount)
			return { ...base, status: "violated", detail: `The posting offers ${range}${compared.note}.${extra}` };
		return { ...base, status: "unknown", detail: `The range ${range}${compared.note} spans this amount.${extra}` };
	};

	const floor = rule?.salaryFloor ?? preference.floor;
	if (floor !== null) {
		const exceptions = preference.exceptions.length > 0;
		checks.push(
			threshold(
				"salary:floor",
				rule?.salaryFloor != null ? `Absolute minimum in ${rule.label}` : "Absolute minimum",
				exceptions ? "strong" : "must",
				floor,
				exceptions ? ` You'd consider less for exceptional ${list(preference.exceptions)}.` : "",
			),
		);
	}
	const preferred = rule?.salaryPreferred ?? preference.preferred;
	if (preferred !== null)
		checks.push(
			threshold(
				"salary:preferred",
				rule?.salaryPreferred != null ? `Preferred minimum in ${rule.label}` : "Preferred minimum",
				"strong",
				preferred,
			),
		);
	if (preference.targetMin !== null || preference.targetMax !== null) {
		const low = preference.targetMin ?? 0;
		const high = preference.targetMax ?? Number.POSITIVE_INFINITY;
		const label = `Target ${preference.targetMin !== null ? money(low, currency) : ""}${preference.targetMax !== null ? `–${money(high, currency)}` : "+"} / ${period}`;
		checks.push({
			key: "salary:target",
			label,
			priority: "nice",
			legacy,
			...(!compared.ok || !posting
				? { status: "unknown" as const, detail: compared.ok ? "" : compared.detail }
				: posting.max >= low
					? { status: "met" as const, detail: `The posting offers ${range}${compared.note}.` }
					: { status: "violated" as const, detail: `The posting offers ${range}${compared.note}.` }),
		});
	}
	return checks;
}

const EMPLOYMENT_SYNONYMS: Record<string, PostingTerms["employment"][number]> = {
	permanent: "permanent",
	"full-time": "full-time",
	"full time": "full-time",
	fulltime: "full-time",
	contract: "contract",
	contractor: "contract",
	"fixed-term": "contract",
	"fixed term": "contract",
	temporary: "temporary",
	temp: "temporary",
	"part-time": "part-time",
	"part time": "part-time",
	casual: "casual",
};
/** Types that can't both describe one job: a permanent role isn't a contract, full-time isn't part-time. */
const EXCLUSIVE: Partial<Record<PostingTerms["employment"][number], Array<PostingTerms["employment"][number]>>> = {
	permanent: ["contract", "temporary", "casual"],
	contract: ["permanent"],
	temporary: ["permanent"],
	"full-time": ["part-time", "casual"],
	"part-time": ["full-time"],
	casual: ["permanent", "full-time"],
};

const ORGANIZATION_SYNONYMS: Record<string, string[]> = {
	nonprofit: ["nonprofit", "non-profit", "not-for-profit", "not for profit", "charity", "charitable", "NGO"],
	"non-profit": ["nonprofit", "non-profit", "not-for-profit", "not for profit", "charity", "charitable", "NGO"],
	charity: ["charity", "charitable", "nonprofit", "non-profit", "not-for-profit"],
	"public sector": [
		"public sector",
		"government",
		"municipal",
		"municipality",
		"provincial",
		"federal",
		"city of",
		"county of",
		"ministry",
	],
	government: ["government", "municipal", "municipality", "provincial", "federal", "ministry", "public sector"],
	education: ["university", "college", "school board", "school district", "education", "academic"],
	"higher education": ["university", "college", "higher education", "post-secondary", "postsecondary"],
	healthcare: ["hospital", "health", "healthcare", "clinic"],
	association: ["association", "member organization", "membership organization", "society", "chapter"],
	startup: ["startup", "start-up", "early-stage", "seed", "series a"],
};

function organizationCheck(preference: OrganizationPreference, posting: Posting, terms: PostingTerms): Draft {
	const base = {
		key: `org:${preference.id}`,
		label: `${preference.stance === "avoid" ? "Avoid" : "Want"}: ${preference.value}`,
		priority: preference.priority,
	};
	const value = preference.value.trim().toLocaleLowerCase();
	if (preference.kind === "employmentType" && EMPLOYMENT_SYNONYMS[value]) {
		const type = EMPLOYMENT_SYNONYMS[value];
		const stated = terms.employment;
		const statedText = list(stated);
		const conflicting = (EXCLUSIVE[type] ?? []).some((other) => stated.includes(other));
		if (stated.length === 0)
			return { ...base, status: "unknown", detail: "The posting doesn't say what kind of employment it is." };
		const includes = stated.includes(type);
		const satisfied = preference.stance === "want" ? includes : !includes && conflicting;
		const unmet = preference.stance === "want" ? !includes && conflicting : includes;
		return {
			...base,
			status: satisfied ? "met" : unmet ? "violated" : "unknown",
			detail: `The posting says ${statedText}.`,
		};
	}
	const terms_ = ORGANIZATION_SYNONYMS[value] ?? [preference.value];
	const text = `${posting.role}\n${posting.location}\n${posting.text}`;
	const found = terms_.find((term) =>
		term.includes(" ") || term.length <= 4 ? mentions(text, term) : matchOpportunity(text, [term]).matches.length > 0,
	);
	if (preference.stance === "avoid")
		return found
			? { ...base, status: "violated", detail: `The posting mentions "${found}".` }
			: {
					...base,
					status: "unknown",
					detail: `The posting doesn't mention ${preference.value}; that isn't proof either way.`,
				};
	return found
		? { ...base, status: "met", detail: `The posting mentions "${found}".` }
		: { ...base, status: "unknown", detail: `The posting doesn't mention ${preference.value}.` };
}

const PRIORITY_ORDER: Record<PreferencePriority, number> = { must: 0, strong: 1, nice: 2 };

export function evaluatePreferences(
	profile: CareerProfileData,
	posting: Posting,
	overrides: ReadonlySet<string> = new Set(),
): PreferenceEvaluation {
	const structured = profile.structured ?? EMPTY_STRUCTURED_PREFERENCES;
	const salaryPreference: SalaryPreference | null =
		structured.salary ??
		(profile.minBase.amount !== null
			? {
					currency: profile.minBase.currency,
					period: profile.minBase.period,
					floor: null,
					preferred: profile.minBase.amount,
					targetMin: null,
					targetMax: null,
					exceptions: [],
					exceptionNote: "",
				}
			: null);
	const terms = readPostingTerms({
		text: posting.text,
		location: posting.location,
		userCurrency: salaryPreference?.currency ?? null,
	});
	const drafts: Draft[] = [];

	// Location: structured rules, else the original office-days limit and places, as strong preferences.
	let rule: LocationRule | null = null;
	if (structured.locationRules.length > 0) {
		const result = locationChecks(structured.locationRules, posting, terms, false);
		drafts.push(...result.checks);
		rule = result.rule;
	} else {
		if (profile.maxOfficeDays !== null)
			drafts.push(
				...locationChecks(
					[
						{
							id: "legacy",
							label: "Anywhere",
							scope: "anywhere",
							places: [],
							country: null,
							radiusKm: null,
							arrangements: ["onsite", "hybrid", "remote"],
							preferredArrangement: null,
							preferredOfficeDays: null,
							maxOfficeDays: profile.maxOfficeDays,
							maxCommuteMinutes: null,
							relocation: true,
							priority: "strong",
							salaryFloor: null,
							salaryPreferred: null,
						},
					],
					posting,
					terms,
					true,
				).checks.map((check) => ({ ...check, key: "legacy:office-days" })),
			);
		if (profile.locations.length > 0) {
			const where = `${posting.location}\n${posting.text.slice(0, 600)}`;
			const place = profile.locations.find((name) => mentions(where, name));
			const remoteOnly = terms.arrangements.length === 1 && terms.arrangements[0] === "remote";
			drafts.push({
				key: "legacy:locations",
				label: `In ${list(profile.locations)}`,
				priority: "strong",
				legacy: true,
				status: place ? "met" : remoteOnly || !posting.location.trim() ? "unknown" : "violated",
				detail: place
					? `The posting mentions ${place}.`
					: remoteOnly
						? "It's remote; check where it's open to."
						: posting.location.trim()
							? `It's in ${posting.location.trim()}.`
							: "The posting doesn't say where the work is.",
			});
		}
	}

	if (salaryPreference) drafts.push(...salaryChecks(salaryPreference, rule, terms, !structured.salary));
	for (const preference of structured.organization) drafts.push(organizationCheck(preference, posting, terms));

	if (profile.targetRoles.length > 0) {
		const matched = matchOpportunity(posting.role, profile.targetRoles).matches;
		drafts.push({
			key: "roles",
			label: "One of your target roles",
			priority: "nice",
			status: matched.length ? "met" : "violated",
			detail: matched.length ? `The title matches ${list(matched)}.` : `"${posting.role}" doesn't match a target role.`,
		});
	}

	const checks: PreferenceCheck[] = drafts
		.map((draft) => ({
			...draft,
			legacy: draft.legacy ?? false,
			status: overrides.has(draft.key) ? ("overridden" as const) : draft.status,
		}))
		.toSorted((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

	return { ...summarize(checks), checks, rule: rule ? { id: rule.id, label: rule.label } : null };
}

function summarize(checks: PreferenceCheck[]): Pick<PreferenceEvaluation, "verdict" | "summary"> {
	const labels = (priority: PreferencePriority, status: PreferenceCheck["status"]) =>
		checks.filter((check) => check.priority === priority && check.status === status).map((check) => check.label);
	const conflicts = labels("must", "violated");
	if (conflicts.length)
		return {
			verdict: "conflict",
			summary: `Doesn't meet ${plural(conflicts.length, "must-have")}: ${listAll(conflicts)}.`,
		};
	const unconfirmed = labels("must", "unknown");
	const missed = labels("strong", "violated");
	const tail = missed.length ? ` Misses ${plural(missed.length, "strong preference")}: ${listAll(missed)}.` : "";
	if (unconfirmed.length)
		return { verdict: "check", summary: `Nothing rules it out, but confirm ${listAll(unconfirmed)}.${tail}` };
	const met = labels("strong", "met").length + labels("nice", "met").length;
	const hasMusts = checks.some((check) => check.priority === "must");
	const lead = hasMusts ? "Meets your must-haves." : "No must-haves to check.";
	return {
		verdict: "fits",
		summary: `${lead}${tail || (met ? ` Matches ${plural(met, "other preference")}.` : "")}`,
	};
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const VERDICT_ORDER: Record<PreferenceEvaluation["verdict"], number> = { fits: 0, check: 1, conflict: 2 };
const count = (evaluation: PreferenceEvaluation, priority: PreferencePriority, status: PreferenceCheck["status"]) =>
	evaluation.checks.filter((check) => check.priority === priority && check.status === status).length;

/**
 * Ranking order, explained step by step instead of a score: verdict first (fits, then needs checking, then
 * conflicts); then fewer missed strong preferences; then more met strong preferences; then more met
 * nice-to-haves; then fewer unconfirmed strong preferences.
 */
export function compareEvaluations(a: PreferenceEvaluation, b: PreferenceEvaluation) {
	return (
		VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
		count(a, "strong", "violated") - count(b, "strong", "violated") ||
		count(b, "strong", "met") - count(a, "strong", "met") ||
		count(b, "nice", "met") - count(a, "nice", "met") ||
		count(a, "strong", "unknown") - count(b, "strong", "unknown")
	);
}
