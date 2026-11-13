import type { Entry } from "./model";
import type { RouterOutput } from "@/libs/orpc/client";
import type { SectionType } from "@reactive-resume/schema/resume/data";
import { createEntry } from "./model";

type MasterProfile = RouterOutput["masterProfile"]["get"];
type ProfileEntry = MasterProfile["entries"][number];
type ProfileSkill = MasterProfile["skills"][number];

/** Master-profile entry kind → the resume section it belongs in. */
const KIND_TO_SECTION: Record<ProfileEntry["kind"], SectionType> = {
	position: "experience",
	project: "projects",
	education: "education",
	volunteer: "volunteer",
	certification: "certifications",
	award: "awards",
};

/** Order the inserted sections appear in. */
const SECTION_ORDER: SectionType[] = [
	"experience",
	"projects",
	"education",
	"volunteer",
	"certifications",
	"awards",
	"skills",
];

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The entry's summary and achievements as the resume's rich-text description (plain profile text, escaped). */
function describe(entry: ProfileEntry): string {
	const parts: string[] = [];
	if (entry.summary.trim()) parts.push(`<p>${escapeHtml(entry.summary.trim())}</p>`);
	const bullets = entry.achievements.filter((achievement) => achievement.text.trim());
	if (bullets.length > 0)
		parts.push(`<ul>${bullets.map((achievement) => `<li>${escapeHtml(achievement.text.trim())}</li>`).join("")}</ul>`);
	return parts.join("");
}

// Profile dates use the same year-month shape as resume dates; a start with no end reads as ongoing.
function datesOf(entry: ProfileEntry) {
	return { start: entry.startDate, end: entry.endDate, present: Boolean(entry.startDate) && !entry.endDate };
}

function mapEntry(entry: ProfileEntry): Entry {
	const base = createEntry(KIND_TO_SECTION[entry.kind]) as Record<string, unknown>;
	const common = {
		dates: datesOf(entry),
		website: { url: entry.url, label: "", inlineLink: false },
		description: describe(entry),
	};
	const fields: Record<ProfileEntry["kind"], Record<string, unknown>> = {
		position: { company: entry.organization, position: entry.title, location: entry.location },
		project: { name: entry.title },
		education: { school: entry.organization, degree: entry.title, location: entry.location },
		volunteer: { organization: entry.organization, location: entry.location },
		certification: { title: entry.title, issuer: entry.organization },
		award: { title: entry.title, awarder: entry.organization },
	};
	return { ...base, ...common, ...fields[entry.kind] } as Entry;
}

function mapSkill(skill: ProfileSkill): Entry {
	const base = createEntry("skills") as Record<string, unknown>;
	return { ...base, name: skill.name, level: skill.level ?? 0, keywords: skill.aliases } as Entry;
}

export type ProfileSelection = { entryIds: ReadonlySet<string>; skillIds: ReadonlySet<string> };

/** Map the chosen master-profile records into resume entries, grouped by section type in a stable order. */
export function profileSelectionToSections(
	profile: MasterProfile,
	selection: ProfileSelection,
): { type: SectionType; entries: Entry[] }[] {
	const byType = new Map<SectionType, Entry[]>();
	const add = (type: SectionType, entry: Entry) => byType.set(type, [...(byType.get(type) ?? []), entry]);

	for (const entry of profile.entries) {
		if (selection.entryIds.has(entry.id)) add(KIND_TO_SECTION[entry.kind], mapEntry(entry));
	}
	for (const skill of profile.skills) {
		if (selection.skillIds.has(skill.id)) add("skills", mapSkill(skill));
	}
	return SECTION_ORDER.filter((type) => byType.has(type)).map((type) => ({ type, entries: byType.get(type) ?? [] }));
}
