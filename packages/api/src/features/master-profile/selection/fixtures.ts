import type { MasterProfile } from "../service";
import type { AnalysisOutput } from "./analysis";
import { normalizeAnalysis } from "./analysis";

/**
 * Representative career histories and job analyses for the selection acceptance tests. Fictional people and
 * employers; shaped like real master profiles (positions with achievements, projects, volunteer work, skills).
 */

type Entry = MasterProfile["entries"][number];
type Achievement = MasterProfile["standalone"][number];
type Skill = MasterProfile["skills"][number];

const stamp = { createdAt: new Date(0), updatedAt: new Date(0), userId: "u", sortOrder: 0, hidden: false };

export const achievement = (
	id: string,
	entryId: string | null,
	text: string,
	extra: Partial<Achievement> = {},
): Achievement => ({
	...stamp,
	id,
	entryId,
	text,
	metrics: [],
	skills: [],
	tags: [],
	variants: [],
	core: false,
	...extra,
});

export const entry = (
	id: string,
	kind: Entry["kind"],
	title: string,
	organization: string,
	startDate: string | null,
	endDate: string | null,
	achievements: Array<[string, string, Partial<Achievement>?]>,
	extra: Partial<Entry> = {},
): Entry => ({
	...stamp,
	id,
	kind,
	title,
	organization,
	location: "",
	url: "",
	summary: "",
	tags: [],
	startDate,
	endDate,
	achievements: achievements.map(([key, text, more]) => achievement(key, id, text, more)),
	...extra,
});

export const skill = (
	id: string,
	name: string,
	category = "",
	aliases: string[] = [],
	more: Partial<Pick<Skill, "kind" | "entryIds">> = {},
): Skill => ({
	...stamp,
	id,
	name,
	category,
	level: null,
	years: null,
	aliases,
	kind: "skill",
	entryIds: [],
	...more,
});

/** A web consultant for nonprofits with communications, development and project-delivery evidence. */
export function consultantProfile(): MasterProfile {
	return {
		entries: [
			entry("e-founder", "position", "Founder & Principal", "Northbrook Digital", "2019-03", null, [
				[
					"a-portal",
					"Rebuilt a WordPress volunteer portal for a regional volunteer centre, cutting coordinator admin time by 40%",
					{ metrics: [{ value: "40", unit: "%", label: "less admin time" }], skills: ["WordPress", "PHP"] },
				],
				[
					"a-plugin",
					"Built a custom WordPress plugin and REST API integration syncing event registrations to Airtable",
					{ skills: ["WordPress", "PHP", "REST APIs", "Airtable"] },
				],
				[
					"a-a11y",
					"Audited and remediated 14 nonprofit websites to WCAG 2.1 AA accessibility",
					{ metrics: [{ value: "14", unit: "", label: "websites" }], skills: ["Accessibility"] },
				],
				[
					"a-discovery",
					"Led discovery workshops with nonprofit boards and staff to scope website rebuilds and set priorities",
					{ skills: ["Stakeholder management"] },
				],
				[
					"a-conference",
					"Delivered the registration platform for a 600-attendee professional conference on time and under its $25,000 budget, coordinating 5 vendors",
					{
						metrics: [
							{ value: "600", unit: "", label: "attendees" },
							{ value: "25,000", unit: "$", label: "budget" },
						],
						skills: ["Project management"],
					},
				],
				[
					"a-campaign",
					"Planned and ran a donor email and social media campaign for a food bank that raised $48,000 in six weeks",
					{ metrics: [{ value: "48,000", unit: "$", label: "raised" }], skills: ["Email marketing", "Social media"] },
				],
				[
					"a-newsletter",
					"Wrote and designed monthly newsletters for 3 association clients, growing open rates from 22% to 38%",
					{ metrics: [{ value: "38", unit: "%", label: "open rate" }], skills: ["Copywriting"] },
				],
			]),
			entry(
				"e-comms",
				"position",
				"Communications Coordinator",
				"Riverside Community Foundation",
				"2016-05",
				"2019-02",
				[
					[
						"a-annual",
						"Produced the foundation's annual report and impact stories, distributed to 2,500 donors",
						{ metrics: [{ value: "2,500", unit: "", label: "donors" }], skills: ["Copywriting"] },
					],
					[
						"a-media",
						"Wrote press releases and pitched local media, earning 30+ news stories about community grants",
						{ skills: ["Media relations"] },
					],
					[
						"a-social",
						"Grew the foundation's social media following by 150% in two years",
						{ metrics: [{ value: "150", unit: "%", label: "follower growth" }], skills: ["Social media"] },
					],
					["a-events", "Coordinated logistics for 12 donor recognition events a year", { skills: ["Event planning"] }],
				],
			),
			entry("e-retail", "position", "Sales Associate", "Maple Outfitters", "2011-06", "2014-08", [
				["a-retail-1", "Responsible for opening and closing the store and handling cash"],
				["a-retail-2", "Recognized as top seller for camping equipment two quarters in a row"],
			]),
			entry("e-civic", "project", "Council Votes Tracker", "Personal project", "2025-01", null, [
				[
					"a-civic",
					"Built a React and TypeScript web app that catalogues city council votes from public minutes, with a searchable councillor record",
					{ skills: ["React", "TypeScript"] },
				],
				[
					"a-scraper",
					"Automated data collection with a Playwright scraper and a Node.js pipeline feeding a Postgres database",
					{ skills: ["Node.js", "PostgreSQL", "Playwright"] },
				],
			]),
			entry("e-volunteer", "volunteer", "UX Team Chair", "Volunteer Centre Board", "2020-01", "2024-06", [
				[
					"a-ux",
					"Chaired a volunteer UX team redesigning the volunteer matching platform with 40 nonprofit partners",
					{ skills: ["UX research"] },
				],
			]),
			entry("e-bba", "education", "BBA, Entrepreneurship", "Lakeview University", "2010-09", "2014-04", []),
			entry("e-pmp", "certification", "Google Project Management Certificate", "Coursera", "2023-05", "2023-05", []),
		],
		standalone: [],
		skills: [
			skill("s-wp", "WordPress", "Web development", ["WP"]),
			skill("s-php", "PHP", "Web development"),
			skill("s-js", "JavaScript", "Web development", ["JS"]),
			skill("s-react", "React", "Web development"),
			skill("s-ts", "TypeScript", "Web development", ["TS"]),
			skill("s-a11y", "Accessibility", "Web development", ["WCAG", "AODA"]),
			skill("s-pm", "Project management", "Delivery"),
			skill("s-stake", "Stakeholder management", "Delivery"),
			skill("s-copy", "Copywriting", "Communications"),
			skill("s-social", "Social media", "Communications"),
			skill("s-media", "Media relations", "Communications"),
			skill("s-email", "Email marketing", "Communications"),
			skill("s-airtable", "Airtable", "Data"),
			skill("s-excel", "Excel", "Data"),
		],
	};
}

const requirement = (
	text: string,
	importance: number,
	necessity: "mandatory" | "preferred",
	terms: string[] = [],
	kind: "skill" | "qualification" | "competency" | "responsibility" | "domain" = "qualification",
	origin: "explicit" | "inferred" = "explicit",
) => ({ text, importance, necessity, terms, kind, origin });

export const analysisOf = (
	output: Partial<AnalysisOutput> & Pick<AnalysisOutput, "requirements">,
	posting = "posting",
) =>
	normalizeAnalysis(
		{ title: "", employer: "", seniority: "intermediate", summary: "", responsibilities: [], domain: [], ...output },
		{ role: "", company: "", posting, extracted: [], model: "test", now: new Date("2026-11-01T00:00:00Z") },
	);

export const communicationsJob = () =>
	analysisOf({
		title: "Communications Manager",
		employer: "Harbourview Food Bank",
		seniority: "manager",
		requirements: [
			requirement(
				"Plan and run multi-channel communications campaigns",
				5,
				"mandatory",
				["campaigns", "outreach", "email marketing", "social media"],
				"responsibility",
			),
			requirement(
				"Nonprofit or charitable sector communications experience",
				5,
				"mandatory",
				["nonprofit", "charity", "foundation"],
				"domain",
			),
			requirement(
				"Excellent writing and storytelling",
				4,
				"mandatory",
				["copywriting", "press releases", "annual report", "newsletters"],
				"skill",
			),
			requirement(
				"Donor communications and fundraising support",
				4,
				"preferred",
				["donor", "fundraising appeals"],
				"domain",
			),
			requirement("Media relations", 3, "preferred", ["press", "news coverage"], "skill"),
			requirement(
				"Manage relationships with partners and volunteers",
				3,
				"preferred",
				["stakeholders", "volunteers"],
				"competency",
				"inferred",
			),
		],
	});

export const webDevJob = () =>
	analysisOf({
		title: "Web Developer",
		employer: "Civic Tech Co-op",
		seniority: "intermediate",
		requirements: [
			requirement(
				"Build and maintain websites and web applications",
				5,
				"mandatory",
				["web development", "web app"],
				"responsibility",
			),
			requirement(
				"JavaScript, React and TypeScript",
				5,
				"mandatory",
				["React", "TypeScript", "JavaScript", "front-end"],
				"skill",
			),
			requirement("WordPress and PHP development", 4, "mandatory", ["WordPress", "PHP", "plugin"], "skill"),
			requirement(
				"API integrations and data pipelines",
				4,
				"preferred",
				["REST API", "integration", "Node.js", "database"],
				"skill",
			),
			requirement("Web accessibility (WCAG)", 3, "preferred", ["WCAG", "accessibility"], "skill"),
			requirement(
				"Work with non-technical clients",
				2,
				"preferred",
				["stakeholders", "clients"],
				"competency",
				"inferred",
			),
		],
	});

export const projectManagementJob = () =>
	analysisOf({
		title: "Project Manager",
		employer: "Provincial Association of Planners",
		seniority: "senior",
		requirements: [
			requirement(
				"Deliver projects on time and on budget",
				5,
				"mandatory",
				["delivery", "budget", "schedule", "timeline"],
				"responsibility",
			),
			requirement(
				"Coordinate vendors, staff and volunteers",
				5,
				"mandatory",
				["coordination", "vendors", "logistics"],
				"competency",
			),
			requirement(
				"Stakeholder management with boards and members",
				4,
				"mandatory",
				["boards", "stakeholders", "workshops"],
				"competency",
			),
			requirement(
				"Project management certification (PMP or equivalent)",
				3,
				"preferred",
				["PMP", "project management certificate"],
				"qualification",
			),
			requirement("Event or conference delivery", 3, "preferred", ["conference", "events", "registration"], "domain"),
			requirement(
				"Reporting on project scope and results",
				2,
				"preferred",
				["reporting", "metrics"],
				"skill",
				"inferred",
			),
		],
	});

export { requirement };
