import type { AssembledBullet } from "../assemble/build";
import type { MasterProfile } from "../service";
import type { JobAnalysis, ResumeSelectionPlan } from "@reactive-resume/schema/resume-selection";
import type { QualityFinding, WritingReport, WritingRules } from "@reactive-resume/schema/resume-writing";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { jaccard, tokens, words } from "../selection/text";
import { isSoftSkill } from "./skills";
import { CLICHES, limitSentences } from "./write";

/** Which profile entry each built resume item came from. */
export type Placement = {
	section: "experience" | "projects" | "volunteer" | "education" | "certifications" | "awards";
	itemId: string;
	entryId: string;
};

type Entry = MasterProfile["entries"][number];

const CONVENTIONAL_HEADINGS = new Set(
	[
		"summary",
		"profile",
		"professional summary",
		"professional profile",
		"experience",
		"work experience",
		"professional experience",
		"employment",
		"employment history",
		"relevant experience",
		"education",
		"skills",
		"core skills",
		"key skills",
		"technical skills",
		"projects",
		"selected projects",
		"volunteer",
		"volunteer experience",
		"community involvement",
		"certifications",
		"certifications & training",
		"licenses & certifications",
		"awards",
		"awards & recognition",
		"languages",
		"interests",
		"publications",
		"references",
		"profiles",
		"links",
	].map((heading) => words(heading).join(" ")),
);

const PLACEHOLDER = /\[[^\]]*\]|\bX{2,}%?|\bTBD\b|\blorem ipsum\b|\?\?/i;
const PERSONAL = /\b(date of birth|birth ?date|dob|age|marital status|sin|social insurance|nationality|gender)\b/i;

export const htmlText = (html: string) =>
	html
		.replace(/<\/(p|li|h\d)>/g, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();

const listItems = (html: string) =>
	[...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => htmlText(match[1] ?? ""));
const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
const sentences = (text: string) => text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.filter((item) => item.trim()) ?? [];
const clip = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Years of work across included and excluded positions, from the earliest start to now (rough, for page targets). */
export function experienceYears(profile: MasterProfile, now: Date) {
	const starts = profile.entries
		.filter((entry) => entry.kind === "position" && entry.startDate)
		.map((entry) => Number(entry.startDate?.slice(0, 4)));
	return starts.length ? now.getFullYear() - Math.min(...starts) : 0;
}

/**
 * Deterministic quality checks on an assembled resume, before the user sees it. Errors mean something isn't
 * backed by the record; warnings and notes point at length, repetition and conventions. Nothing is changed.
 */
export function checkResume(input: {
	data: ResumeData;
	bullets: AssembledBullet[];
	placements: Placement[];
	plan: ResumeSelectionPlan;
	profile: MasterProfile;
	analysis: JobAnalysis | null;
	rules: WritingRules;
	headline: string;
	now?: Date;
}): { findings: QualityFinding[]; stats: WritingReport["stats"] } {
	const { data, bullets, placements, plan, profile, rules } = input;
	const now = input.now ?? new Date();
	const findings: QualityFinding[] = [];
	const add = (finding: QualityFinding) => findings.push(finding);
	const entries = new Map(profile.entries.map((entry) => [entry.id, entry]));
	const achievements = new Map(
		profile.entries.flatMap((entry) => entry.achievements.map((item) => [item.id, item] as const)),
	);
	const planned = new Set(
		plan.entries
			.filter((entry) => entry.include)
			.flatMap((entry) => entry.achievements.filter((item) => item.include).map((item) => item.achievementId)),
	);

	// Sources: every bullet comes from an included achievement of the profile.
	for (const bullet of bullets) {
		if (!achievements.has(bullet.achievementId))
			add({
				code: "missing-source",
				severity: "error",
				message: `"${clip(bullet.text)}" has no source record in your profile.`,
			});
		else if (!planned.has(bullet.achievementId))
			add({
				code: "missing-source",
				severity: "error",
				message: `"${clip(bullet.text)}" isn't in the reviewed selection.`,
			});
	}

	type Item = {
		id: string;
		description?: string;
		position?: string;
		company?: string;
		dates?: { start: string | null; end: string | null; present: boolean };
	};
	const sectionItems = (key: Placement["section"]) => (data.sections[key].items as unknown as Item[]) ?? [];
	const placed = new Map(placements.map((placement) => [placement.itemId, placement]));
	const allBulletTexts: Array<{ text: string; itemId: string }> = [];

	for (const key of ["experience", "projects", "volunteer", "education", "certifications", "awards"] as const) {
		for (const item of sectionItems(key)) {
			const placement = placed.get(item.id);
			const entry = placement ? entries.get(placement.entryId) : undefined;
			if (!entry) {
				add({
					code: "entry-not-in-profile",
					severity: "error",
					message:
						key === "education" || key === "certifications"
							? "A qualification on the resume isn't in your profile."
							: "An entry on the resume isn't in your profile.",
					section: key,
					itemId: item.id,
				});
				continue;
			}
			if (key === "experience") {
				if (item.position !== entry.title)
					add({
						code: "title-mismatch",
						severity: "error",
						message: `The title "${item.position}" differs from your record ("${entry.title}").`,
						section: key,
						itemId: item.id,
					});
				if (entry.organization && item.company !== entry.organization)
					add({
						code: "title-mismatch",
						severity: "error",
						message: `The employer "${item.company}" differs from your record ("${entry.organization}").`,
						section: key,
						itemId: item.id,
					});
			}
			if (item.dates && key !== "certifications" && key !== "awards") {
				const expected = { start: entry.startDate, end: entry.endDate };
				if (item.dates.start !== expected.start || item.dates.end !== expected.end)
					add({
						code: "date-mismatch",
						severity: "error",
						message: `The dates for "${entry.title}" differ from your record.`,
						section: key,
						itemId: item.id,
					});
			}
			const texts = listItems(item.description ?? "");
			const ours = bullets.filter((bullet) => bullet.entryId === entry.id);
			if (texts.length !== ours.length)
				add({
					code: "unsupported-bullet",
					severity: "error",
					message: `"${entry.title}" has ${texts.length} bullets but ${ours.length} come from your record.`,
					section: key,
					itemId: item.id,
				});
			for (const text of texts) allBulletTexts.push({ text, itemId: item.id });
			if (key === "experience" && texts.length === 0)
				add({
					code: "empty-entry",
					severity: "info",
					message: `"${entry.title}" has no bullets; consider including one achievement or leaving it out.`,
					section: key,
					itemId: item.id,
				});
		}
	}

	// Reverse chronological order within each section.
	const end = (entry: Entry) => entry.endDate ?? (entry.startDate ? "9999" : "0000");
	for (const key of ["experience", "projects", "volunteer", "education"] as const) {
		const list = sectionItems(key)
			.map((item) => entries.get(placed.get(item.id)?.entryId ?? ""))
			.filter((entry): entry is Entry => Boolean(entry));
		for (let index = 1; index < list.length; index++) {
			const previous = list[index - 1];
			const current = list[index];
			if (previous && current && end(previous) < end(current)) {
				add({
					code: "order",
					severity: "warning",
					message: `"${current.title}" is more recent than "${previous.title}" but listed after it.`,
					section: key,
				});
				break;
			}
		}
	}

	// Repetition: two bullets saying the same thing.
	const bulletTokens = allBulletTexts.map((bullet) => ({ ...bullet, tokens: tokens(bullet.text) }));
	for (let i = 0; i < bulletTokens.length; i++)
		for (let j = i + 1; j < bulletTokens.length; j++) {
			const a = bulletTokens[i];
			const b = bulletTokens[j];
			if (a && b && jaccard(a.tokens, b.tokens) >= 0.7)
				add({
					code: "duplicate-bullet",
					severity: "warning",
					message: `Two bullets say nearly the same: "${clip(a.text)}" and "${clip(b.text)}".`,
					itemId: b.itemId,
				});
		}

	for (const bullet of allBulletTexts) {
		const count = countWords(bullet.text);
		if (count > rules.bullets.maxWords)
			add({
				code: "bullet-length",
				severity: "warning",
				message: `A bullet runs to ${count} words: "${clip(bullet.text)}".`,
				itemId: bullet.itemId,
			});
		if (count < 4)
			add({
				code: "bullet-length",
				severity: "info",
				message: `A bullet is very short: "${bullet.text}".`,
				itemId: bullet.itemId,
			});
		if (PLACEHOLDER.test(bullet.text))
			add({
				code: "placeholder",
				severity: "error",
				message: `A bullet still has a placeholder: "${clip(bullet.text)}".`,
				itemId: bullet.itemId,
			});
	}

	// Skills: count, duplicates, and only skills from the profile.
	const skillItems = (
		data.sections.skills.items as Array<{ name: string; keywords: string[]; hidden: boolean }>
	).filter((item) => !item.hidden);
	const keywords = skillItems.flatMap((item) => item.keywords);
	const profileSkillNames = new Set(
		profile.skills.flatMap((skill) => [skill.name, ...skill.aliases]).map((name) => words(name).join(" ")),
	);
	if (keywords.length > rules.skills.max)
		add({
			code: "skills-count",
			severity: "warning",
			message: `${keywords.length} skills are listed; around ${rules.skills.min}–${rules.skills.max} reads better.`,
			section: "skills",
		});
	else if (keywords.length < rules.skills.min && keywords.length > 0)
		add({
			code: "skills-count",
			severity: "info",
			message: `${keywords.length} skills are listed. Add skills your included achievements show to reach about ${rules.skills.min}.`,
			section: "skills",
		});
	if (skillItems.length > rules.skills.maxGroups)
		add({
			code: "skills-count",
			severity: "info",
			message: `Skills are split into ${skillItems.length} groups; ${rules.skills.minGroups}–${rules.skills.maxGroups} is easier to scan.`,
			section: "skills",
		});
	const seen = new Map<string, string>();
	for (const keyword of keywords) {
		const normalized = words(keyword).join(" ");
		if (seen.has(normalized))
			add({
				code: "duplicate-skill",
				severity: "warning",
				message: `"${keyword}" is listed twice.`,
				section: "skills",
			});
		seen.set(normalized, keyword);
		if (!profileSkillNames.has(normalized))
			add({
				code: "unsupported-skill",
				severity: "error",
				message: `"${keyword}" isn't a skill in your profile.`,
				section: "skills",
			});
		if (isSoftSkill(keyword))
			add({
				code: "soft-skill",
				severity: "info",
				message: `"${keyword}" is a soft skill; it's stronger shown in a bullet.`,
				section: "skills",
			});
		if (
			skillItems.some((item) => item.keywords.length > 0) &&
			/\b(expert|advanced|beginner|intermediate|proficient)\b/i.test(keyword)
		)
			add({
				code: "unsupported-skill",
				severity: "warning",
				message: `"${keyword}" includes a proficiency level.`,
				section: "skills",
			});
	}

	// Sections, contact details and summary.
	const experience = sectionItems("experience");
	if (experience.length === 0)
		add({
			code: "missing-section",
			severity: "error",
			message: "The resume has no work experience.",
			section: "experience",
		});
	if (keywords.length === 0)
		add({ code: "missing-section", severity: "warning", message: "The resume lists no skills.", section: "skills" });
	if (sectionItems("education").length === 0 && profile.entries.some((entry) => entry.kind === "education"))
		add({
			code: "missing-section",
			severity: "info",
			message: "Education is left out; most resumes include it.",
			section: "education",
		});
	if (!data.basics.name.trim()) add({ code: "missing-contact", severity: "warning", message: "Add your name." });
	if (!data.basics.email.trim())
		add({ code: "missing-contact", severity: "warning", message: "Add an email address." });
	if (!data.basics.phone.trim() || !data.basics.location.trim())
		add({
			code: "missing-contact",
			severity: "info",
			message: "Add a phone number and your city and province or state.",
		});
	const positions = experience.length;
	if (
		positions > rules.positions.max ||
		(positions < rules.positions.min &&
			profile.entries.filter((entry) => entry.kind === "position").length >= rules.positions.min)
	)
		add({
			code: "too-long",
			severity: "info",
			message: `${positions} positions are included; ${rules.positions.min}–${rules.positions.max} is usual.`,
			section: "experience",
		});

	const summary = data.summary.hidden ? "" : htmlText(data.summary.content);
	if (rules.summary.enabled) {
		if (!summary)
			add({ code: "missing-section", severity: "warning", message: "There's no summary.", section: "summary" });
		else {
			const count = sentences(summary).length;
			if (count > rules.summary.maxSentences || countWords(summary) > rules.summary.maxWords)
				add({
					code: "summary-length",
					severity: "warning",
					message: `The summary has ${count} sentences and ${countWords(summary)} words; aim for ${rules.summary.minSentences}–${rules.summary.maxSentences} sentences. Suggested: "${clip(limitSentences(summary, rules.summary.maxSentences), 120)}"`,
					section: "summary",
				});
		}
	}

	// Wording: clichés, keyword stuffing, personal details.
	const allText = [input.headline, summary, ...allBulletTexts.map((bullet) => bullet.text)].join("\n");
	const lower = ` ${allText.toLowerCase()} `;
	const cliches = CLICHES.filter((phrase) => lower.includes(phrase));
	if (cliches.length > 0)
		add({
			code: "cliche",
			severity: "warning",
			message: `Replace filler phrases with specifics: ${cliches.join(", ")}.`,
		});
	const terms = new Set(
		(input.analysis?.requirements ?? [])
			.flatMap((requirement) => [requirement.text, ...requirement.terms])
			.map((term) => words(term).join(" "))
			.filter((term) => term.length >= 4),
	);
	const spaced = ` ${words(allText).join(" ")} `;
	for (const term of terms) {
		const count =
			spaced.match(new RegExp(`(?<= )${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= )`, "g"))?.length ?? 0;
		// A core term naturally recurs on a focused resume; six or more uses reads as stuffing.
		if (count > 5)
			add({
				code: "keyword-repetition",
				severity: "warning",
				message: `"${term}" appears ${count} times; vary the wording or let the evidence speak.`,
			});
	}
	if (data.picture.url && !data.picture.hidden && rules.region !== "other")
		add({
			code: "personal-details",
			severity: "info",
			message: "A photo is shown; it's not expected on resumes in this region and some screening tools drop it.",
		});
	for (const field of data.basics.customFields)
		if (PERSONAL.test(field.text))
			add({
				code: "personal-details",
				severity: "warning",
				message: `"${field.text}" is a personal detail employers here don't ask for.`,
			});
	for (const [key, section] of Object.entries(data.sections) as Array<
		[string, { title: string; hidden: boolean; items: unknown[] }]
	>) {
		if (section.hidden || section.items.length === 0 || !section.title.trim()) continue;
		if (!CONVENTIONAL_HEADINGS.has(words(section.title).join(" ")))
			add({
				code: "heading",
				severity: "info",
				message: `The "${section.title}" heading is unusual; screening tools read conventional headings best.`,
				section: key,
			});
	}

	// Length: an estimate from word count; the rendered PDF is the final word.
	const entryWords =
		(experience.length +
			sectionItems("projects").length +
			sectionItems("volunteer").length +
			sectionItems("education").length) *
		8;
	const words_ = countWords(allText) + keywords.length * 1.5 + entryWords + skillItems.length * 2;
	const estimatedPages = Math.round((words_ / rules.wordsPerPage) * 10) / 10;
	const targetPages =
		experienceYears(profile, now) >= rules.pages.experiencedYears ? rules.pages.experienced : rules.pages.early;
	if (estimatedPages > targetPages + 0.2)
		add({
			code: "too-long",
			severity: "warning",
			message: `About ${estimatedPages} pages of content for a ${targetPages}-page target. Leave out bullets from older or less relevant roles rather than shrinking the text.`,
		});
	else if (estimatedPages < targetPages * 0.45 && targetPages > 1)
		add({
			code: "too-short",
			severity: "info",
			message: `About ${estimatedPages} pages of content; there's room for more relevant achievements.`,
		});

	const severity = { error: 0, warning: 1, info: 2 };
	return {
		findings: findings.toSorted((a, b) => severity[a.severity] - severity[b.severity]),
		stats: {
			words: Math.round(words_),
			estimatedPages,
			targetPages,
			positions,
			bullets: allBulletTexts.length,
			skills: keywords.length,
		},
	};
}
