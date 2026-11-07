import { words } from "../selection/text";

/**
 * Checks for rewritten text beyond numbers (see assemble/grounding.ts): a rewrite may not drop the user's
 * honest qualifiers ("about", "nearly", "~"), and may not name a tool or skill the source doesn't.
 */

const QUALIFIERS =
	/(~|\b(?:about|approximately|approx\.?|around|nearly|almost|roughly|over|more than|up to|under|less than|estimated|some|several|at least|close to)\b)/i;

/** True when the source qualifies an amount and the rewrite still does. */
export function keepsQualifiers(source: string, rewrite: string): boolean {
	return !QUALIFIERS.test(source) || QUALIFIERS.test(rewrite);
}

/** Tools and platforms commonly named on resumes; with the profile's own skills, what a rewrite may not invent. */
export const TOOLS = [
	"wordpress",
	"elementor",
	"woocommerce",
	"drupal",
	"shopify",
	"squarespace",
	"wix",
	"php",
	"javascript",
	"typescript",
	"react",
	"vue",
	"angular",
	"node.js",
	"python",
	"java",
	"c#",
	"sql",
	"postgresql",
	"mysql",
	"excel",
	"power bi",
	"tableau",
	"google analytics",
	"salesforce",
	"hubspot",
	"mailchimp",
	"constant contact",
	"canva",
	"figma",
	"photoshop",
	"illustrator",
	"indesign",
	"airtable",
	"zapier",
	"jira",
	"asana",
	"trello",
	"monday.com",
	"slack",
	"aws",
	"azure",
	"gcp",
	"docker",
	"kubernetes",
	"git",
	"playwright",
	"raiser's edge",
	"blackbaud",
	"quickbooks",
	"sap",
	"ms project",
	"smartsheet",
];

const phrase = (text: string) => ` ${words(text).join(" ")} `;

/** Tool names in the rewrite that none of the sources mention. */
export function introducedTools(rewrite: string, sources: string[], profileSkills: string[]): string[] {
	const text = phrase(rewrite);
	const known = phrase(sources.join(" | "));
	const names = [...new Set([...TOOLS, ...profileSkills.map((name) => words(name).join(" "))])].filter(
		(name) => name.length >= 2,
	);
	return names.filter(
		(name) => text.includes(` ${words(name).join(" ")} `) && !known.includes(` ${words(name).join(" ")} `),
	);
}
