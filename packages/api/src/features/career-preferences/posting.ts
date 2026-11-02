import type { WorkArrangement } from "@reactive-resume/schema/career-preferences";

/**
 * What a posting states about where, how and on what terms the work happens, read with plain patterns. Anything a
 * posting doesn't state clearly is left unknown: unknown is never read as a yes or a no.
 */

export type PostingSalary = {
	min: number;
	max: number;
	/** ISO code when the posting names one, or a "$" amount assumed to be in the user's dollar currency. */
	currency: string | null;
	currencyAssumed: boolean;
	period: "hour" | "month" | "year" | null;
	periodAssumed: boolean;
	/** Pay that a base salary can't be compared with: commission, per-project or per-day rates. */
	incomparable: string | null;
};

export type PostingTerms = {
	arrangements: WorkArrangement[];
	officeDays: number | null;
	salary: PostingSalary | null;
	employment: Array<"permanent" | "contract" | "temporary" | "part-time" | "full-time" | "casual">;
	relocationRequired: boolean;
};

const has = (text: string, pattern: RegExp) => pattern.test(text);

const NOT_REMOTE =
	/\b(?:not|no|non)[-\s](?:an?\s+)?(?:fully\s+)?remote\b|\bremote (?:work )?(?:is )?not (?:available|possible|an option)\b/i;
const REMOTE =
	/\b(?:fully[-\s]remote|100% remote|remote[-\s](?:first|friendly|position|role|work|eligible)|work(?:ing)? (?:from|at) home|wfh|telecommut\w*|remote)\b/i;
const HYBRID = /\bhybrid\b|\b\d\s*(?:days?|x)\s*(?:a|per|\/)?\s*week (?:in|at) (?:the )?office\b|\bpartially remote\b/i;
const ONSITE = /\b(?:on[-\s]?site|in[-\s]office|in[-\s]person|office[-\s]based|at our office)\b/i;

/** Work arrangements the posting names. A posting mentioning both remote and on-site usually means hybrid. */
export function readArrangements(text: string): WorkArrangement[] {
	const found = new Set<WorkArrangement>();
	if (has(text, HYBRID)) found.add("hybrid");
	if (has(text, REMOTE) && !has(text, NOT_REMOTE)) found.add("remote");
	if (has(text, ONSITE) || has(text, NOT_REMOTE)) found.add("onsite");
	if (found.has("remote") && found.has("onsite") && !found.has("hybrid")) return ["hybrid"];
	return [...found];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const DAYS = String.raw`(\d|one|two|three|four|five)`;
const OFFICE_DAYS = [
	new RegExp(
		String.raw`\b${DAYS}\s*(?:days?|x)\s*(?:a|per|\/)?\s*week\s*(?:in|at|on)\s*(?:the\s*)?(?:office|site|person)`,
		"i",
	),
	new RegExp(String.raw`\b${DAYS}\s*(?:days?)\s*(?:in[-\s]office|on[-\s]?site|in[-\s]person)`, "i"),
	new RegExp(String.raw`\b(?:in[-\s]office|on[-\s]?site|in[-\s]person)\s*${DAYS}\s*days?`, "i"),
];

export function readOfficeDays(text: string): number | null {
	for (const pattern of OFFICE_DAYS) {
		const match = pattern.exec(text)?.[1]?.toLowerCase();
		if (match) {
			const days = NUMBER_WORDS[match] ?? Number(match);
			if (days >= 0 && days <= 5) return days;
		}
	}
	return null;
}

const CODES = "CAD|USD|EUR|GBP|AUD|NZD|CHF|SEK|NOK|DKK|PLN|INR|JPY";
const SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR" };
const AMOUNT = String.raw`(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(k|K)?`;
const MONEY = new RegExp(
	String.raw`(?:(${CODES})\s*|(C\$|CA\$|US\$|A\$|\$|€|£|¥|₹)\s*)` +
		AMOUNT +
		String.raw`(?:\s*(?:-|–|—|to)\s*(?:(?:${CODES})\s*|(?:C\$|CA\$|US\$|A\$|\$|€|£|¥|₹)\s*)?${AMOUNT})?` +
		String.raw`(?:\s*(${CODES}))?`,
	"g",
);
const PERIOD_AFTER =
	/^\s*(?:\/|per|an|a)\s*(hour|hr|h|year|yr|annum|month|mo)\b|^\s*(hourly|annually|yearly|monthly)\b/i;
const PERIOD_WORDS: Record<string, PostingSalary["period"]> = {
	hour: "hour",
	hr: "hour",
	h: "hour",
	hourly: "hour",
	year: "year",
	yr: "year",
	annum: "year",
	annually: "year",
	yearly: "year",
	month: "month",
	mo: "month",
	monthly: "month",
};

const toNumber = (raw: string, thousands: string | undefined) =>
	Number(raw.replaceAll(/[,\s]/g, "")) * (thousands ? 1000 : 1);

/**
 * The pay a posting states. `$` alone is read as the user's currency when that's a dollar currency, and says so;
 * a range without a period is read as yearly only when it's clearly an annual amount.
 */
export function readSalary(text: string, userCurrency: string | null): PostingSalary | null {
	const candidates: PostingSalary[] = [];
	for (const match of text.matchAll(MONEY)) {
		const [whole, code, symbol, first, firstK, second, secondK, trailingCode] = match;
		if (!first) continue;
		const min = toNumber(first, firstK);
		const max = second ? toNumber(second, secondK ?? firstK) : min;
		if (!Number.isFinite(min) || min <= 0) continue;
		// Ignore money that isn't pay: "a $5M budget", "$300 in credits". Pay is at least 7 an hour.
		if (max < 7) continue;
		let currency = code ?? trailingCode ?? null;
		let currencyAssumed = false;
		if (!currency && symbol) {
			if (SYMBOLS[symbol]) currency = SYMBOLS[symbol] ?? null;
			else if (symbol === "C$" || symbol === "CA$") currency = "CAD";
			else if (symbol === "US$") currency = "USD";
			else if (symbol === "A$") currency = "AUD";
			else if (userCurrency && /^(CAD|USD|AUD|NZD)$/.test(userCurrency)) {
				currency = userCurrency;
				currencyAssumed = true;
			}
		}
		const after = text.slice((match.index ?? 0) + whole.length, (match.index ?? 0) + whole.length + 20);
		const periodWord = PERIOD_AFTER.exec(after);
		let period = periodWord ? (PERIOD_WORDS[(periodWord[1] ?? periodWord[2] ?? "").toLowerCase()] ?? null) : null;
		let periodAssumed = false;
		if (!period && min >= 20_000) {
			period = "year";
			periodAssumed = true;
		}
		const context = text.slice(Math.max(0, (match.index ?? 0) - 60), (match.index ?? 0) + whole.length + 60);
		const incomparable = /\bcommission\b/i.test(context)
			? "commission"
			: /\bper (?:project|diem|day)\b|\bday rate\b/i.test(context)
				? "per-project or daily rate"
				: null;
		candidates.push({
			min: Math.min(min, max),
			max: Math.max(min, max),
			currency,
			currencyAssumed,
			period,
			periodAssumed,
			incomparable,
		});
	}
	// The most explicit statement wins: one with a period, then the largest (base pay rather than a perk).
	return (
		candidates.toSorted((a, b) => Number(Boolean(b.period)) - Number(Boolean(a.period)) || b.max - a.max)[0] ?? null
	);
}

const EMPLOYMENT: Array<[PostingTerms["employment"][number], RegExp]> = [
	["permanent", /\bpermanent\b/i],
	["contract", /\bcontract(?:or)?\b(?! of)|\bfixed[-\s]term\b|\bterm position\b/i],
	["temporary", /\btemporary\b|\btemp\b|\bmaternity (?:leave )?(?:cover|replacement)\b/i],
	["part-time", /\bpart[-\s]time\b/i],
	["full-time", /\bfull[-\s]time\b/i],
	["casual", /\bcasual\b(?! dress)/i],
];

export function readPostingTerms(input: { text: string; location: string; userCurrency: string | null }): PostingTerms {
	const all = `${input.location}\n${input.text}`;
	return {
		arrangements: readArrangements(all),
		officeDays: readOfficeDays(all),
		salary: readSalary(input.text, input.userCurrency),
		employment: EMPLOYMENT.filter(([, pattern]) => pattern.test(input.text)).map(([kind]) => kind),
		relocationRequired: /\b(?:must|required to|willing(?:ness)? to) relocate\b|\brelocation (?:is )?required\b/i.test(
			input.text,
		),
	};
}
