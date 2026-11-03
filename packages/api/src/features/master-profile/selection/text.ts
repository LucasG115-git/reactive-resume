/**
 * Small, dependency-free text matching for evidence retrieval: tokens with light stemming, and groups of
 * terms that mean the same thing on a resume, so "donor relations" can answer "fundraising".
 */

const STOPWORDS = new Set(
	`a an and are as at be by for from has have in into is it its of on or our that the their this to was were will with you your we they he she them his her who what which while within across over per via etc using use used able ability strong excellent proven demonstrated experience experienced years year work working including include includes other new well related relevant knowledge skills skill understanding plus asset preferred required must should can may also`.split(
		/\s+/,
	),
);

/** Strips common English endings so "coordinated", "coordinating" and "coordination" meet. */
export function stem(word: string): string {
	let w = word;
	for (const suffix of [
		"ations",
		"ation",
		"ments",
		"ment",
		"ings",
		"ing",
		"ities",
		"ity",
		"ies",
		"ers",
		"er",
		"ed",
		"es",
		"s",
	]) {
		if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
			w = suffix === "ies" || suffix === "ities" ? `${w.slice(0, -suffix.length)}y` : w.slice(0, -suffix.length);
			break;
		}
	}
	return w;
}

export function words(text: string): string[] {
	return (
		text
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			// Keep tech names like c#, c++, .net, node.js together.
			.match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? []
	);
}

export function tokens(text: string): Set<string> {
	const out = new Set<string>();
	for (const word of words(text)) {
		if (STOPWORDS.has(word) || word.length < 2) continue;
		out.add(stem(word));
	}
	return out;
}

/**
 * Terms that a posting and a career record use for the same thing. Each group is matched as a whole: a
 * record mentioning any member counts for a requirement mentioning any other. Kept short and general; the
 * job analysis adds posting-specific alternatives.
 */
export const SYNONYM_GROUPS: string[][] = [
	["communications", "comms", "public relations", "pr", "media relations", "messaging", "press release", "publicity"],
	["social media", "instagram", "facebook", "linkedin", "tiktok", "twitter", "social channels"],
	["content", "copywriting", "writing", "editorial", "blog", "newsletter", "storytelling"],
	["campaign", "outreach", "advocacy", "awareness", "engagement campaign"],
	["marketing", "digital marketing", "brand", "branding", "promotion", "email marketing", "seo", "sem"],
	[
		"fundraising",
		"fundraiser",
		"donor",
		"donors",
		"donor relations",
		"raised",
		"appeal",
		"appeals",
		"grant writing",
		"sponsorship",
		"philanthropy",
		"major gifts",
	],
	[
		"nonprofit",
		"non-profit",
		"not-for-profit",
		"charity",
		"charitable",
		"ngo",
		"association",
		"community organization",
	],
	[
		"stakeholder",
		"stakeholders",
		"client",
		"clients",
		"board",
		"boards",
		"partner",
		"partners",
		"volunteer",
		"volunteers",
	],
	[
		"project management",
		"project manager",
		"delivery",
		"deliver",
		"delivered",
		"coordinate",
		"coordinated",
		"coordination",
		"schedule",
		"timeline",
		"milestone",
		"scope",
		"pmp",
		"agile",
		"scrum",
	],
	["budget", "budgets", "financial", "cost", "costs", "spend", "revenue", "funding"],
	["team", "teams", "led", "lead", "leadership", "managed", "manage", "supervised", "mentored", "staff"],
	[
		"web development",
		"web developer",
		"website",
		"websites",
		"web",
		"front-end",
		"frontend",
		"back-end",
		"backend",
		"full-stack",
	],
	["wordpress", "cms", "elementor", "woocommerce", "drupal", "content management system"],
	["javascript", "js", "typescript", "ts", "react", "node", "node.js", "vue"],
	["php", "laravel"],
	["html", "css", "tailwind", "sass"],
	["accessibility", "a11y", "wcag", "aoda", "inclusive design"],
	["ux", "user experience", "usability", "user research", "ui", "design", "prototype", "figma"],
	["data", "analytics", "reporting", "dashboard", "dashboards", "metrics", "kpi", "kpis", "airtable", "excel", "sql"],
	[
		"automation",
		"automate",
		"automated",
		"integration",
		"integrations",
		"api",
		"apis",
		"zapier",
		"make.com",
		"workflow",
	],
	["event", "events", "conference", "conferences", "registration", "ticketing"],
	[
		"training",
		"workshop",
		"workshops",
		"facilitate",
		"facilitated",
		"facilitation",
		"teach",
		"taught",
		"presentations",
	],
	["research", "analysis", "analyze", "analyzed", "evaluate", "evaluation", "assessment"],
	["policy", "government", "municipal", "council", "public sector", "civic"],
	["entrepreneur", "founder", "founded", "business owner", "self-employed", "consultancy", "consultant", "freelance"],
];

// Single-word members only: "donor relations" shouldn't make every record mentioning "relations" a match.
const GROUP_STEMS: Array<Set<string>> = SYNONYM_GROUPS.map(
	(group) => new Set(group.filter((term) => !/\s/.test(term.trim())).flatMap((term) => [...tokens(term)])),
);

/** The text's tokens plus every member of each synonym group a phrase of the text belongs to. */
export function expand(text: string): Set<string> {
	const original = tokens(text);
	const base = new Set(original);
	const lower = ` ${words(text).join(" ")} `;
	for (const [index, group] of SYNONYM_GROUPS.entries()) {
		// Matched against the text itself, so one group's terms never pull in another group.
		const hit = group.some((term) => {
			const phrase = words(term).join(" ");
			return phrase.includes(" ") ? lower.includes(` ${phrase} `) : original.has(stem(phrase));
		});
		if (hit) for (const token of GROUP_STEMS[index] ?? []) base.add(token);
	}
	return base;
}

export function overlap(a: Set<string>, b: Set<string>): number {
	let count = 0;
	for (const token of a) if (b.has(token)) count++;
	return count;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	const shared = overlap(a, b);
	return shared / (a.size + b.size - shared);
}
