import type { RouterOutput } from "@/libs/orpc/client";
import type { PROFILE_FILE_SECTIONS } from "@reactive-resume/schema/master-profile";
import { stringify as stringifyYaml } from "yaml";
import { download } from "./profile-file";

type MasterProfile = RouterOutput["masterProfile"]["get"];
type Entry = MasterProfile["entries"][number];
type Achievement = Entry["achievements"][number];
type Skill = MasterProfile["skills"][number];

type FileSection = keyof typeof PROFILE_FILE_SECTIONS;

/** Profile entry kind → the profile-file section that holds it (inverse of PROFILE_FILE_SECTIONS). */
const KIND_TO_SECTION: Record<Entry["kind"], FileSection> = {
	position: "experience",
	project: "projects",
	education: "education",
	volunteer: "volunteer",
	certification: "certifications",
	award: "awards",
};

/** Only emit fields that carry information, so the file stays close to what a person would write by hand. */
function toFileAchievement(achievement: Achievement) {
	return {
		text: achievement.text,
		...(achievement.metrics.length > 0 ? { metrics: achievement.metrics } : {}),
		...(achievement.skills.length > 0 ? { skills: achievement.skills } : {}),
		...(achievement.tags.length > 0 ? { tags: achievement.tags } : {}),
		...(achievement.variants.length > 0 ? { variants: achievement.variants } : {}),
		...(achievement.core ? { core: true } : {}),
		...(achievement.hidden ? { hidden: true } : {}),
	};
}

function toFileEntry(entry: Entry) {
	return {
		title: entry.title,
		...(entry.organization ? { organization: entry.organization } : {}),
		...(entry.location ? { location: entry.location } : {}),
		...(entry.url ? { url: entry.url } : {}),
		...(entry.startDate ? { start: entry.startDate } : {}),
		...(entry.endDate ? { end: entry.endDate } : {}),
		...(entry.summary ? { summary: entry.summary } : {}),
		...(entry.tags.length > 0 ? { tags: entry.tags } : {}),
		...(entry.hidden ? { hidden: true } : {}),
		...(entry.achievements.length > 0 ? { achievements: entry.achievements.map(toFileAchievement) } : {}),
	};
}

// The profile-file skill shape has no skill/tool `kind` field, so that distinction isn't represented here;
// everything else (level, years, category, aliases) round-trips through the import.
function toFileSkill(skill: Skill) {
	return {
		name: skill.name,
		...(skill.category ? { category: skill.category } : {}),
		...(skill.level !== null ? { level: skill.level } : {}),
		...(skill.years !== null ? { years: skill.years } : {}),
		...(skill.aliases.length > 0 ? { aliases: skill.aliases } : {}),
		...(skill.hidden ? { hidden: true } : {}),
	};
}

/**
 * Serialise the whole master profile into the profile-file shape (`profileFileSchema`), so it round-trips
 * through the existing import. Standalone achievements aren't an entry kind in that format, so they're kept
 * under a dedicated "Other achievements" experience entry rather than dropped.
 */
export function buildProfileFile(profile: MasterProfile) {
	const sections: Record<FileSection, ReturnType<typeof toFileEntry>[]> = {
		experience: [],
		projects: [],
		education: [],
		volunteer: [],
		certifications: [],
		awards: [],
	};
	for (const entry of profile.entries) sections[KIND_TO_SECTION[entry.kind]].push(toFileEntry(entry));
	if (profile.standalone.length > 0) {
		sections.experience.push({ title: "Other achievements", achievements: profile.standalone.map(toFileAchievement) });
	}
	return {
		version: 1 as const,
		...sections,
		skills: profile.skills.map(toFileSkill),
	};
}

export type ProfileExportFormat = "yaml" | "json";

/** Build the profile file and download it as YAML or JSON. */
export function downloadProfileFile(profile: MasterProfile, format: ProfileExportFormat) {
	const file = buildProfileFile(profile);
	if (format === "json") {
		download(JSON.stringify(file, null, 2), "master-profile.json", "application/json");
	} else {
		download(stringifyYaml(file), "master-profile.yaml", "text/yaml");
	}
}
