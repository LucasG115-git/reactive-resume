import type {
	ProfileAchievementInput,
	ProfileEntryInput,
	ProfileEntryKind,
	ProfileSkillInput,
} from "@reactive-resume/schema/master-profile";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import { profileEntryInputSchema, profileSkillInputSchema } from "@reactive-resume/schema/master-profile";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Plain text from editor HTML, with entities decoded and whitespace collapsed. */
export function htmlText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<[^<>]*>/g, " ")
		.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, name: string) => {
			const lower = name.toLowerCase();
			if (ENTITIES[lower]) return ENTITIES[lower];
			if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
			if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
			return match;
		})
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Bullet candidates from an item description: each list item, or else each paragraph. A single prose
 * paragraph becomes the entry's summary instead (see `splitDescription`).
 */
export function splitDescription(html: string): { bullets: string[]; summary: string } {
	const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => htmlText(match[1] ?? ""));
	const listless = html.replace(/<(ul|ol)\b[\s\S]*?<\/\1>/gi, "");
	const paragraphs = [...listless.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => htmlText(match[1] ?? ""));
	const leftover = paragraphs.length === 0 && items.length === 0 ? htmlText(html) : "";

	if (items.length > 0) return { bullets: items.filter(Boolean), summary: paragraphs.filter(Boolean).join(" ") };
	const prose = [...paragraphs, leftover].filter(Boolean);
	// Several short paragraphs read like bullets; one paragraph reads like a description.
	if (prose.length > 1) return { bullets: prose, summary: "" };
	return { bullets: [], summary: prose[0] ?? "" };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const datesOf = (dates: ResumeDates | undefined) => ({
	startDate: dates?.start ?? null,
	endDate: dates?.present ? null : (dates?.end ?? null),
});

/** For single-date items (certifications, awards) the date is when it was received. */
const singleDateOf = (dates: ResumeDates | undefined) => ({ startDate: dates?.start ?? null, endDate: null });

export type ImportedEntry = { entry: ProfileEntryInput; achievements: Omit<ProfileAchievementInput, "entryId">[] };
export type ResumeImport = { entries: ImportedEntry[]; skills: ProfileSkillInput[] };

/** Turns one resume's sections into master-profile records. Nothing is invented: every value comes from the resume. */
export function resumeToProfile(data: ResumeData): ResumeImport {
	const entries: ImportedEntry[] = [];

	const add = (
		kind: ProfileEntryKind,
		values: { title: string; organization?: string; location?: string; url?: string; description: string },
		dates: { startDate: string | null; endDate: string | null },
	) => {
		const title = values.title.trim() || values.organization?.trim() || "";
		if (!title) return;
		const split = splitDescription(values.description);
		// A project, volunteer role, certification or award described in one paragraph is itself the achievement;
		// for jobs and education, a lone paragraph describes the scope.
		const proseIsAchievement = split.bullets.length === 0 && kind !== "position" && kind !== "education";
		const bullets = proseIsAchievement && split.summary ? [split.summary] : split.bullets;
		const summary = proseIsAchievement ? "" : split.summary;
		// Dates the resume couldn't read exactly are left blank rather than guessed.
		const valid = profileEntryInputSchema.safeParse({
			kind,
			title: clip(title, 200),
			organization: clip(values.title.trim() ? (values.organization ?? "").trim() : "", 200),
			location: clip(values.location ?? "", 200),
			url: /^https?:\/\//.test(values.url ?? "") ? values.url : "",
			...dates,
			summary: clip(summary, 2000),
		});
		const entry = valid.success
			? valid.data
			: profileEntryInputSchema.parse({ kind, title: clip(title, 200), summary: clip(summary, 2000) });
		entries.push({
			entry,
			achievements: bullets.map((text) => ({
				text: clip(text, 1000),
				metrics: [],
				skills: [],
				tags: [],
				variants: [],
				core: false,
				hidden: false,
			})),
		});
	};

	const { sections } = data;
	/**
	 * A section's visible items plus those in visible custom sections of the same type ("Earlier experience",
	 * "Selected projects"), which many resumes use for older or secondary history.
	 */
	const itemsOf = <
		K extends "experience" | "projects" | "education" | "volunteer" | "certifications" | "awards" | "skills",
	>(
		type: K,
	): Array<(typeof sections)[K]["items"][number]> => [
		...(sections[type].items as Array<(typeof sections)[K]["items"][number]>),
		...data.customSections
			.filter((section) => section.type === type && !section.hidden)
			.flatMap((section) => section.items as Array<(typeof sections)[K]["items"][number]>),
	];
	for (const item of itemsOf("experience")) {
		if (item.hidden) continue;
		// Several roles at one employer become one entry per role, each with its own bullets.
		if (item.roles.length > 0) {
			for (const role of item.roles)
				add(
					"position",
					{
						title: role.position,
						organization: item.company,
						location: item.location,
						url: item.website.url,
						description: role.description,
					},
					datesOf(role.dates),
				);
			continue;
		}
		add(
			"position",
			{
				title: item.position,
				organization: item.company,
				location: item.location,
				url: item.website.url,
				description: item.description,
			},
			datesOf(item.dates),
		);
	}
	for (const item of itemsOf("projects"))
		if (!item.hidden)
			add("project", { title: item.name, url: item.website.url, description: item.description }, datesOf(item.dates));
	for (const item of itemsOf("education"))
		if (!item.hidden)
			add(
				"education",
				{
					title: [item.degree, item.area].filter(Boolean).join(", "),
					organization: item.school,
					location: item.location,
					url: item.website.url,
					description: item.description,
				},
				datesOf(item.dates),
			);
	for (const item of itemsOf("volunteer"))
		if (!item.hidden)
			add(
				"volunteer",
				{
					title: "",
					organization: item.organization,
					location: item.location,
					url: item.website.url,
					description: item.description,
				},
				datesOf(item.dates),
			);
	for (const item of itemsOf("certifications"))
		if (!item.hidden)
			add(
				"certification",
				{ title: item.title, organization: item.issuer, url: item.website.url, description: item.description },
				singleDateOf(item.dates),
			);
	for (const item of itemsOf("awards"))
		if (!item.hidden)
			add(
				"award",
				{ title: item.title, organization: item.awarder, url: item.website.url, description: item.description },
				singleDateOf(item.dates),
			);

	// A skill item with keywords is a group ("Web: WordPress, PHP"); without keywords it's one skill.
	const skills: ProfileSkillInput[] = [];
	const seen = new Set<string>();
	const addSkill = (name: string, category: string, level: number) => {
		const clean = clip(name.trim(), 100);
		const key = clean.toLocaleLowerCase();
		if (!clean || seen.has(key)) return;
		seen.add(key);
		skills.push(
			profileSkillInputSchema.parse({
				name: clean,
				category: clip(category.trim(), 100),
				level: level > 0 ? level : null,
			}),
		);
	};
	for (const item of itemsOf("skills")) {
		if (item.hidden) continue;
		if (item.keywords.length > 0) for (const keyword of item.keywords) addSkill(keyword, item.name, 0);
		else addSkill(item.name, "", item.level);
	}

	return { entries, skills };
}
