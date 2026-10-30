/**
 * Grounding checks for AI-phrased resume text. The model may reword, but it may not introduce numbers
 * (amounts, percentages, counts, years) that the user's own record doesn't contain, and it may not pad a
 * bullet into something much longer than what the user wrote.
 */

/** Every number in the text, normalized: "1,200" → "1200", "3.5x" → "3.5", "40%" → "40". */
export function numbersIn(text: string): Set<string> {
	const found = new Set<string>();
	for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
		const normalized = match[0].replaceAll(",", "").replace(/\.0+$/, "");
		if (normalized) found.add(normalized);
	}
	return found;
}

/**
 * Number words a rewrite might use for a digit the source wrote out, or the reverse. "One", "half" and
 * "double" are left out: they're everyday words ("one of", "double-checked") far more often than claims.
 */
const NUMBER_WORDS: Record<string, string> = {
	two: "2",
	three: "3",
	four: "4",
	five: "5",
	six: "6",
	seven: "7",
	eight: "8",
	nine: "9",
	ten: "10",
	twelve: "12",
	twenty: "20",
	hundred: "100",
	dozen: "12",
	doubled: "2",
	triple: "3",
	tripled: "3",
};

/** Numbers stated in words ("three", "doubled"), as digits. */
export function numberWordsIn(text: string): Set<string> {
	const found = new Set<string>();
	for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
		const digit = NUMBER_WORDS[word];
		if (digit) found.add(digit);
	}
	return found;
}

export type GroundingResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether `rewritten` only uses facts present in `sources`. Numbers are checked strictly: each number in
 * the rewrite (in digits or common words) must appear in a source, in digits or words.
 */
export function checkGrounded(rewritten: string, sources: string[], maxLength?: number): GroundingResult {
	const text = rewritten.trim();
	if (!text) return { ok: false, reason: "empty" };

	const allowed = new Set<string>();
	for (const source of sources) {
		for (const number of numbersIn(source)) allowed.add(number);
		for (const number of numberWordsIn(source)) allowed.add(number);
	}

	const introduced = [...numbersIn(text)].filter((number) => !allowed.has(number));
	if (introduced.length > 0) return { ok: false, reason: `introduced number ${introduced.join(", ")}` };

	// Words like "doubled" only fail when the record has no matching number either way.
	const wordNumbers = [...numberWordsIn(text)].filter((number) => !allowed.has(number));
	if (wordNumbers.length > 0) return { ok: false, reason: `introduced number ${wordNumbers.join(", ")}` };

	if (maxLength !== undefined && text.length > maxLength) return { ok: false, reason: "too long" };
	return { ok: true };
}

/** A rewrite may be up to 60% longer than the longest source wording, plus a little room for short bullets. */
export function lengthBudget(sources: string[]): number {
	const longest = Math.max(0, ...sources.map((source) => source.length));
	return Math.round(longest * 1.6) + 40;
}
