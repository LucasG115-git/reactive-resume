import { words } from "../selection/text";

/**
 * Resume line hygiene: deterministic clean-ups applied to every printed line, whether the AI reworded it or the
 * user's own words are printed. They only remove or reformat; they never add a claim. Each returns what changed so
 * the report can tell the user to fix the record itself.
 */

// ---- Evidence notes ----

/**
 * Words that mark a note about the evidence rather than the achievement: who reported it, whether it's verified,
 * what wasn't finished. Notes like these belong in the career record, never on a resume, where they read as doubt.
 */
const EVIDENCE_MARKER =
	/\b(?:unverified|not (?:yet )?verified|unconfirmed|not confirmed|needs? (?:verification|confirmation|checking)|to be (?:confirmed|verified)|tb[cd]|reportedly|(?:was|were|is|are|been) reported|(?:organi[sz]ational|internal) reporting|claimed|according to (?:internal|organi[sz]ational|the organi[sz]ation)|at (?:that|the) time|definition unclear|timing (?:and [a-z]+ )?unverified|without completing|did not (?:complete|finish)|didn't (?:complete|finish)|not completed|unfinished|i (?:think|believe)|not sure|unsure|citation needed|source:)/i;

/** Trailing phrases that undercut the line they end ("…, without completing either minor"). */
const UNDERCUTTING_TAIL =
	/[,;]?\s+(?:without (?:completing|finishing)|though (?:not|never)|but (?:not|never)|at (?:that|the) time|as of [a-z]+ \d{4}|(?:timing|definition) (?:and [a-z]+ )?unverified)\b[^.;]*/gi;

/** Parenthetical notes: "(unverified)", "(reported, Sept 2023)". */
const NOTE_PARENTHETICAL =
	/\s*\((?=[^)]*\b(?:unverified|not verified|reported|claimed|estimate|approx|tbc|tbd|source)\b)[^)]*\)/gi;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const finish = (text: string, original: string) => {
	const trimmed = text.trim().replace(/[\s,;:—–-]+$/, "");
	if (!trimmed) return "";
	return /[.!?]$/.test(original.trim()) && !/[.!?]$/.test(trimmed) ? `${trimmed}.` : trimmed;
};

export type Cleaned = { text: string; removed: string[]; doubtful: boolean };

/**
 * Removes notes about evidence from a line: clauses after a semicolon or dash that carry one, trailing undercutting
 * phrases and parenthetical notes. The opening clause is kept; when it carries a note itself, `doubtful` is set and
 * the line is left for the user to fix.
 */
export function stripEvidenceNotes(text: string): Cleaned {
	const removed: string[] = [];
	let result = text.replace(NOTE_PARENTHETICAL, (match) => {
		removed.push(match.trim());
		return "";
	});
	const clauses = result.split(/(;\s+|\s+[—–]\s+)/);
	const kept: string[] = [clauses[0] ?? ""];
	for (let index = 1; index < clauses.length; index += 2) {
		const separator = clauses[index] ?? "";
		const clause = clauses[index + 1] ?? "";
		if (EVIDENCE_MARKER.test(clause)) removed.push(clause.trim());
		else kept.push(separator, clause);
	}
	result = kept.join("");
	result = result.replace(UNDERCUTTING_TAIL, (match) => {
		removed.push(match.replace(/^[,;]?\s+/, ""));
		return "";
	});
	const cleaned = removed.length > 0 ? finish(result, text) : text;
	return { text: cleaned || text, removed, doubtful: EVIDENCE_MARKER.test(cleaned || text) };
}

// ---- Approximations ----

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
	eleven: "11",
	twelve: "12",
	fifteen: "15",
	twenty: "20",
	thirty: "30",
	forty: "40",
	fifty: "50",
	hundred: "100",
	"a hundred": "100",
	"a dozen": "12",
	dozen: "12",
};

const APPROXIMATELY = new RegExp(
	`\\b(?:approximately|approx\\.?|roughly|an estimated|estimated)\\s+(\\$?\\d[\\d,.]*(?:\\s?(?:%|k|m|million|thousand))?|${Object.keys(NUMBER_WORDS).join("|")})\\b`,
	"gi",
);

/**
 * "approximately 25" becomes "~25" and "approximately five" "~5": the same honest hedge, without a long word that
 * reads as uncertainty when repeated. "about", "nearly" and "over" are left as written.
 */
export function shortenApproximations(text: string): string {
	return text.replace(APPROXIMATELY, (_match, amount: string) => `~${NUMBER_WORDS[amount.toLowerCase()] ?? amount}`);
}

// ---- Tense ----

/** Past tenses that aren't the base form plus -ed. */
const IRREGULAR: Record<string, string> = {
	lead: "led",
	"co-lead": "co-led",
	build: "built",
	rebuild: "rebuilt",
	write: "wrote",
	rewrite: "rewrote",
	"co-write": "co-wrote",
	teach: "taught",
	make: "made",
	oversee: "oversaw",
	grow: "grew",
	drive: "drove",
	give: "gave",
	take: "took",
	undertake: "undertook",
	win: "won",
	bring: "brought",
	sell: "sold",
	set: "set",
	"set up": "set up",
	speak: "spoke",
	begin: "began",
	choose: "chose",
	hold: "held",
	keep: "kept",
	meet: "met",
	send: "sent",
	spend: "spent",
	find: "found",
	become: "became",
	run: "ran",
	cut: "cut",
	draw: "drew",
	shape: "shaped",
	sit: "sat",
	stand: "stood",
	understand: "understood",
	seek: "sought",
	think: "thought",
	plan: "planned",
	ship: "shipped",
	map: "mapped",
	scope: "scoped",
	prep: "prepped",
	pilot: "piloted",
	audit: "audited",
	edit: "edited",
	target: "targeted",
	budget: "budgeted",
	commit: "committed",
	transfer: "transferred",
	control: "controlled",
	refer: "referred",
};

/** Verbs that open resume bullets, in base form; their past tense is regular unless listed above. */
const VERBS = new Set([
	...Object.keys(IRREGULAR),
	...`accelerate achieve acquire adapt administer advise advocate align analyse analyze apply arrange assemble assess
	assist automate boost brief broaden budget calculate champion clarify coach collaborate collect communicate compile
	complete conceive conduct configure consolidate consult contribute convert coordinate create cultivate curate
	customize customise debug decrease define deliver demonstrate deploy design develop devise diagnose direct document
	draft educate eliminate empower enable engage engineer enhance establish evaluate execute expand expedite facilitate
	forecast formalize formalise foster generate guide handle help identify implement improve increase influence inform
	initiate innovate install integrate interview introduce investigate launch liaise maintain manage market measure
	mentor migrate mobilize mobilise moderate modernize modernise monitor motivate negotiate onboard operate optimize
	optimise orchestrate organize organise outline overhaul partner perform persuade pioneer position prepare present
	prioritize prioritise process produce program programme promote propose prototype provide publish raise recommend
	reconcile recruit redesign reduce refactor refine reorganize reorganise report represent research resolve restructure
	review revamp save schedule secure serve simplify solve source spearhead standardize standardise steer streamline
	strengthen structure supervise support survey synthesize synthesise test track train transform translate
	troubleshoot unify update upgrade use utilize utilise validate volunteer`
		.split(/\s+/)
		.filter(Boolean),
]);

const PAST = new Map(
	[...VERBS].map((verb) => {
		if (IRREGULAR[verb]) return [verb, IRREGULAR[verb]];
		if (verb.endsWith("e")) return [verb, `${verb}d`];
		if (/[^aeiou]y$/.test(verb)) return [verb, `${verb.slice(0, -1)}ied`];
		return [verb, `${verb}ed`];
	}),
);

/** The base form of a present-tense opening verb ("Manages" → "manage"), or null. */
function presentVerb(word: string): string | null {
	const lower = word.toLowerCase();
	if (VERBS.has(lower)) return lower;
	if (lower.endsWith("ies") && VERBS.has(`${lower.slice(0, -3)}y`)) return `${lower.slice(0, -3)}y`;
	if (lower.endsWith("es") && VERBS.has(lower.slice(0, -2))) return lower.slice(0, -2);
	if (lower.endsWith("s") && VERBS.has(lower.slice(0, -1))) return lower.slice(0, -1);
	return null;
}

const matchCase = (word: string, like: string) => (/^[A-Z]/.test(like) ? capitalise(word) : word);

/** Puts a bullet's opening verb (and one joined by "and") in the past tense. Unknown openings are left alone. */
export function toPastTense(text: string): string {
	const match = /^(\S+)(\s+(?:and|&)\s+)(\S+)/.exec(text);
	const first = /^(\S+)/.exec(text)?.[1] ?? "";
	const base = presentVerb(first);
	if (!base) return text;
	let result = matchCase(PAST.get(base) ?? first, first) + text.slice(first.length);
	if (match) {
		const second = match[3] ?? "";
		const secondBase = presentVerb(second);
		if (secondBase) {
			const prefix = `${matchCase(PAST.get(base) ?? first, first)}${match[2]}`;
			result = prefix + (PAST.get(secondBase) ?? second) + text.slice(match[0].length);
		}
	}
	return result;
}

/** True when the line opens with a present-tense verb this module knows. */
export const opensInPresent = (text: string) => presentVerb(/^(\S+)/.exec(text)?.[1] ?? "") !== null;

/**
 * One tense per role: bullets open in the past tense, which reads correctly for finished results in a current role
 * too. A current role whose bullets all open in the present tense is left as written.
 */
export function alignTense(lines: string[], current: boolean): string[] {
	if (current && lines.length > 0 && lines.every(opensInPresent)) return lines;
	return lines.map(toPastTense);
}

// ---- Titles, places and links ----

const STOP = new Set(["the", "of", "and", "for", "a", "an", "in", "at", "inc", "ltd", "llc", "corp", "co"]);
const significant = (text: string) => words(text).filter((word) => word.length > 1 && !STOP.has(word));

/**
 * A project or volunteer title with its organization, unless the title already names it: "Volunteer Peterborough —
 * Website Platform" stays as it is rather than gaining "— Volunteer Peterborough" again.
 */
export function titleWithOrganization(title: string, organization: string): string {
	if (!organization.trim()) return title;
	if (!title.trim()) return organization;
	const inTitle = new Set(significant(title));
	// An acronym in the title stands for its words: "PMI" covers "Project Management Institute".
	for (const segment of organization.split(/\s+[—–-]\s+|,/)) {
		const parts = significant(segment);
		const initials = parts.map((word) => word[0]).join("");
		if (parts.length >= 2 && inTitle.has(initials)) for (const word of parts) inTitle.add(word);
	}
	const org = significant(organization);
	const shared = org.filter((word) => inTitle.has(word)).length;
	return org.length > 0 && shared / org.length >= 0.5 ? title : `${title} — ${organization}`;
}

const REGIONS: Record<string, string> = {
	alberta: "AB",
	"british columbia": "BC",
	manitoba: "MB",
	"new brunswick": "NB",
	"newfoundland and labrador": "NL",
	"nova scotia": "NS",
	ontario: "ON",
	"prince edward island": "PE",
	quebec: "QC",
	québec: "QC",
	saskatchewan: "SK",
	"northwest territories": "NT",
	nunavut: "NU",
	yukon: "YT",
	california: "CA",
	"new york": "NY",
	texas: "TX",
	washington: "WA",
	massachusetts: "MA",
	illinois: "IL",
	florida: "FL",
	oregon: "OR",
	colorado: "CO",
	michigan: "MI",
	pennsylvania: "PA",
	georgia: "GA",
	virginia: "VA",
	"north carolina": "NC",
	ohio: "OH",
	minnesota: "MN",
	arizona: "AZ",
	"new jersey": "NJ",
};

const COUNTRIES = /^(canada|usa|u\.s\.a?\.?|united states(?: of america)?|us)$/i;

/** "Peterborough, Ontario, Canada" → "Peterborough, ON": the short form the resume's header uses. */
export function shortLocation(location: string): string {
	const parts = location
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length < 2) return location.trim();
	if (parts.length >= 3 && COUNTRIES.test(parts.at(-1) ?? "")) parts.pop();
	const region = parts.at(-1) ?? "";
	const short = REGIONS[region.toLowerCase()];
	if (short) parts[parts.length - 1] = short;
	return parts.join(", ");
}

const host = (url: string) => {
	try {
		return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
};

/** A link as a reader wants to see it: "pmi.bc.ca", not "https://pmi.bc.ca". */
export const displayUrl = (url: string) => host(url) || url;

/** True when two links go to the same site. */
export const sameSite = (a: string, b: string) => Boolean(host(a)) && host(a) === host(b);

// ---- Headline ----

/** One title, not a list: "Web Developer and Founder | Digital Marketing…" keeps what comes before the first bar. */
export function singleHeadline(headline: string): string {
	const first = headline.split(/\s+[|•·/]\s+|\s+\|\s*|\s*\|\s+/)[0]?.trim() ?? "";
	return first || headline.trim();
}

/** Skill group names short enough to sit on one line beside their skills: "and" becomes "&". */
export const shortGroupName = (name: string) =>
	name
		.replace(/\s+and\s+/gi, " & ")
		.replace(/\s+/g, " ")
		.trim();

// ---- Sensitive content ----

/**
 * Political campaigns and similar: worth leaving off unless the job is in that field, because they invite the
 * reader's own views. Matches the record, not the posting.
 */
const POLITICAL =
	/\b(?:election|electoral|candidate|candidacy|get[- ]out[- ]the[- ]vote|voters?|ballot|canvass(?:ing)?|political|party nomination|(?:council|mayoral|municipal|riding|ward|congressional|senate|campaign) (?:campaign|race|election|candidate))\b/i;

/** Postings where political work is relevant experience. */
const POLITICAL_FIELD =
	/\b(?:government|public affairs|public policy|policy|political|politics|campaigns? (?:manager|director|organizer)|elections?|legislative|municipal|city hall|council|advocacy|civic|public sector|parliament|ministry)\b/i;

export const isPolitical = (text: string) => POLITICAL.test(text);
export const isPoliticalField = (text: string) => POLITICAL_FIELD.test(text);

// ---- Filler and repetition ----

/** Trailing filler that adds nothing a reader can use. */
const FILLER_TAIL =
	/,?\s+(?:with|and) (?:additional|more|further|other|several) (?:projects?|work|clients?|sites?|websites?) (?:in development|underway|in progress|ongoing|to come|planned)\b|,?\s+(?:and more|etc\.?)(?=[.;]?$)/gi;

/** Removes filler tails ("…, with additional projects in development"). */
export function dropFiller(text: string): string {
	const result = text.replace(FILLER_TAIL, "").trim();
	return result && result !== text.trim() ? finish(result, text) : text;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Drops a mention of the entry's own name from its bullet ("…launch for Volunteer Hub" under "Volunteer Hub —
 * Website Platform"): the heading already says it.
 */
export function dropOwnName(text: string, names: string[]): string {
	let result = text;
	for (const name of names.map((item) => item.trim()).filter((item) => item.length >= 4)) {
		result = result.replace(
			new RegExp(`\\s+(?:for|at|with|of|within) (?:the )?${escapeRegExp(name)}(?=[\\s.,;]|$)`, "i"),
			"",
		);
	}
	return result === text ? text : finish(result, text);
}

/** Names the bullets of an entry shouldn't repeat: its organization and the first part of its title. */
export const ownNames = (entry: { title: string; organization: string }) =>
	[entry.organization, entry.title.split(/\s+[—–-]\s+/)[0] ?? ""].filter(Boolean);

/** "~38": a hedge on a number that looks exact reads oddly. Round numbers (≤10, or multiples of 5) are fine. */
export const oddApproximation = (text: string) =>
	[...text.matchAll(/~\s?(\d[\d,]*)/g)]
		.map((match) => Number((match[1] ?? "").replace(/,/g, "")))
		.find((value) => value > 10 && value % 5 !== 0) ?? null;

/** A line that only restates the heading it sits under ("Earned a BBA…" under "BBA, Trent University"). */
export function restatesHeading(text: string, heading: string): boolean {
	const filler = new Set([
		"earned",
		"completed",
		"received",
		"obtained",
		"graduated",
		"with",
		"degree",
		"in",
		"a",
		"an",
		"the",
		"of",
	]);
	const line = words(text).filter((word) => !filler.has(word));
	const head = new Set(words(heading));
	return line.length > 0 && line.filter((word) => head.has(word)).length / line.length >= 0.8;
}
