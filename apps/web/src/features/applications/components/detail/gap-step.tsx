import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { entryLabel, UsedAt } from "../../../career/knowledge/used-at";
import { BuildProgress } from "./build-progress";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Report = NonNullable<RouterOutput["masterProfile"]["gaps"]["get"]>;
type Gap = Report["gaps"][number];
type Entry = RouterOutput["masterProfile"]["get"]["entries"][number];
type Selection = RouterOutput["masterProfile"]["gaps"]["answer"]["selection"];

type Answer = {
	have: boolean | null;
	/** Names of the skills and tools ticked. */
	skills: string[];
	/** Where each ticked skill or tool was used. */
	places: Record<string, string[]>;
	/** Self-rated proficiency (1–5) for each ticked skill, when the user set one. */
	levels: Record<string, number | null>;
	entryId: string | null;
	note: string;
	text: string;
};

const EMPTY: Answer = { have: null, skills: [], places: {}, levels: {}, entryId: null, note: "", text: "" };

const RATING_LABELS = () => [t`None`, t`Adjacent`, t`Some`, t`Strong`];
const RATING_TONES = ["text-danger-text", "text-warn-text", "text-ink-2", "text-success-text"];

type MatchBarProps = { report: Report; className?: string };

/** The match, as a number and a bar, with how it was worked out. */
export function MatchBar({ report, className }: MatchBarProps) {
	const tone = report.match >= 75 ? "bg-success" : report.match >= 50 ? "bg-warn-text" : "bg-danger-text";
	const labels = RATING_LABELS();
	return (
		<div className={cn("grid gap-1.5", className)}>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<p className="text-sm">
					<Trans>
						<span className="text-2xl font-semibold tabular-nums">{report.match}%</span> match for this posting
					</Trans>
				</p>
				<p className="text-xs text-ink-3">
					{report.basis === "ai"
						? t`Judged by your AI connection, requirement by requirement`
						: t`Estimated from keyword matches, which overstates fit`}
				</p>
			</div>
			<div
				className="h-1.5 overflow-hidden rounded-full bg-sunken"
				role="meter"
				aria-label={t`Match for this posting`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={report.match}
			>
				<div className={cn("h-full rounded-full", tone)} style={{ width: `${report.match}%` }} />
			</div>
			{report.summary && <p className="text-[13px] leading-5 text-ink-2">{report.summary}</p>}
			{report.ratings.length > 0 && (
				<details className="group text-[13px]">
					<summary className="w-fit cursor-pointer text-xs font-medium text-ink-2 hover:underline">
						<Trans>How this is worked out</Trans>
					</summary>
					<p className="mt-2 text-xs leading-5 text-ink-3">
						<Trans>
							Each requirement is rated on the evidence proposed for this resume: strong (counts in full), some (60%),
							adjacent (25%) or none. Ratings are weighted by how much the requirement matters, and "nice to have" items
							count for less.
						</Trans>
					</p>
					<ul className="mt-2 grid gap-1.5">
						{report.ratings.map((item) => (
							<li key={item.requirementId} className="grid grid-cols-[4.5rem_1fr] gap-x-2">
								<span className={cn("text-xs font-medium", RATING_TONES[item.rating])}>
									{labels[item.rating] ?? labels[0]}
								</span>
								<span>
									{item.text}
									{item.necessity === "preferred" && (
										<span className="ms-1.5 text-xs text-ink-3">{t`· nice to have`}</span>
									)}
									{item.reason && <span className="block text-xs text-ink-3">{item.reason}</span>}
								</span>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

type GapStepProps = {
	applicationId: string;
	report: Report;
	entries: Entry[];
	onDone: (selection: Selection) => void;
	onSkip: () => void;
};

/**
 * Before the resume is written: what the posting asks for that the profile shows nowhere. The user says whether
 * they have it and where; confirmed skills and experience are saved to their profile, and the selection is
 * proposed again from the larger profile.
 */
export function GapStep({ applicationId, report, entries, onDone, onSkip }: GapStepProps) {
	const open = report.gaps.filter((gap) => gap.answer === null);
	const earlier = report.gaps.length - open.length;
	const [answers, setAnswers] = useState<Record<string, Answer>>({});
	const answerOf = (gap: Gap) => answers[gap.requirementId] ?? EMPTY;
	const set = (gap: Gap, patch: Partial<Answer>) =>
		setAnswers((previous) => ({ ...previous, [gap.requirementId]: { ...answerOf(gap), ...patch } }));

	const save = useMutation({
		...orpc.masterProfile.gaps.answer.mutationOptions(),
		onSuccess: (data) => {
			toast.add({
				description: data.added
					? t`Added ${data.added} items to your profile. Match: ${data.report?.match ?? report.match}%.`
					: t`Saved your answers.`,
			});
			onDone(data.selection);
		},
		onError: (error) => toastError(error, t`Couldn't save to your profile. Try again.`),
	});

	const ready = Object.entries(answers)
		.map(([requirementId, answer]) => {
			const gap = report.gaps.find((item) => item.requirementId === requirementId);
			if (!gap || answer.have === null) return null;
			const text = answer.text.trim() || answer.note.trim();
			return {
				requirementId,
				have: answer.have,
				skills: answer.have
					? gap.skills
							.filter((skill) => answer.skills.includes(skill.name))
							.map((skill) => ({
								name: skill.name,
								kind: skill.kind,
								entryIds: answer.places[skill.name] ?? [],
								level: answer.levels[skill.name] ?? null,
							}))
					: [],
				entryId: answer.have ? answer.entryId : null,
				text: answer.have ? text : "",
			};
		})
		.filter((item) => item !== null)
		.filter((item) => !item.have || item.skills.length > 0 || item.text);

	const named = open.filter((gap) => gap.type === "skill");
	const tools = named.filter((gap) => gap.skills.every((skill) => skill.kind === "tool"));
	const skills = named.filter((gap) => !tools.includes(gap));
	const experience = open.filter((gap) => gap.type === "experience");

	return (
		<div className="grid gap-5">
			<MatchBar report={report} />
			<p className="text-[13px] leading-5 text-ink-2">
				<Trans>
					The posting asks for these, but your profile shows little or nothing for them. If you have them, say where you
					used or did them: they're added to your master profile for this and future resumes. Only add what's true; you
					can skip any of them.
				</Trans>
			</p>

			{[
				{ key: "tools", list: tools, title: t`Tools and platforms you might use` },
				{ key: "skills", list: skills, title: t`Skills you might have` },
			]
				.filter((group) => group.list.length > 0)
				.map((group) => (
					<section key={group.key} className="grid gap-2" aria-labelledby={`${applicationId}-gap-${group.key}`}>
						<h3 id={`${applicationId}-gap-${group.key}`} className="eyebrow text-ink-3">
							{group.title}
						</h3>
						<ul className="grid gap-2">
							{group.list.map((gap) => (
								<SkillGap
									key={gap.requirementId}
									gap={gap}
									answer={answerOf(gap)}
									entries={entries}
									onChange={(patch) => set(gap, patch)}
								/>
							))}
						</ul>
					</section>
				))}

			{experience.length > 0 && (
				<section className="grid gap-2" aria-labelledby={`${applicationId}-gap-experience`}>
					<h3 id={`${applicationId}-gap-experience`} className="eyebrow text-ink-3">
						<Trans>Experience you might have</Trans>
					</h3>
					<ul className="grid gap-2">
						{experience.map((gap) => (
							<ExperienceGap
								key={gap.requirementId}
								applicationId={applicationId}
								gap={gap}
								answer={answerOf(gap)}
								entries={entries}
								onChange={(patch) => set(gap, patch)}
							/>
						))}
					</ul>
				</section>
			)}

			{earlier > 0 && (
				<p className="text-xs text-ink-3">{t`${earlier} more you answered before aren't shown again.`}</p>
			)}

			{save.isPending && <BuildProgress phase="save" />}

			<div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
				<Button variant="ghost" onClick={onSkip}>
					<Trans>Skip for now</Trans>
				</Button>
				<Button
					disabled={ready.length === 0}
					loading={save.isPending}
					onClick={() => save.mutate({ applicationId, answers: ready })}
				>
					<Icon name="check" size={16} />
					<Trans>Save to profile and continue</Trans>
				</Button>
			</div>
		</div>
	);
}

type WhereProps = {
	id: string;
	value: string | null;
	entries: Entry[];
	onChange: (entryId: string | null) => void;
	label: string;
};

/** Which past role, project or course it came from. */
function Where({ id, value, entries, onChange, label }: WhereProps) {
	return (
		<div className="grid gap-1">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<NativeSelect
				id={id}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value || null)}
				className="text-[13px]"
			>
				<option value="">{t`Not tied to one role or project`}</option>
				{entries.map((entry) => (
					<option key={entry.id} value={entry.id}>
						{entryLabel(entry)}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}

type GapProps = { gap: Gap; answer: Answer; entries: Entry[]; onChange: (patch: Partial<Answer>) => void };

function SkillGap({ gap, answer, entries, onChange }: GapProps) {
	const id = useId();
	const toggle = (skill: string, checked: boolean) => {
		const next = checked ? [...answer.skills, skill] : answer.skills.filter((item) => item !== skill);
		onChange({ skills: next, have: next.length > 0 ? true : null });
	};
	const setPlaces = (skill: string, entryIds: string[]) => {
		const places = { ...answer.places, [skill]: entryIds };
		const used = [...new Set(answer.skills.flatMap((name) => places[name] ?? []))];
		// The achievement goes under one of the places named; the first unless the user picked another.
		const entryId = answer.entryId && used.includes(answer.entryId) ? answer.entryId : (used[0] ?? null);
		onChange({ places, entryId });
	};
	const setLevel = (skill: string, level: number | null) => onChange({ levels: { ...answer.levels, [skill]: level } });
	const used = entries.filter((entry) => answer.skills.some((name) => answer.places[name]?.includes(entry.id)));
	return (
		<li className="grid gap-2 rounded-lg border border-line p-3">
			<p className="text-[13px] text-ink-2">
				{gap.text}
				{gap.necessity === "mandatory" && <span className="ms-1.5 text-xs text-ink-3">{t`· required`}</span>}
			</p>
			<ul className="grid gap-2">
				{gap.skills.map((skill) => {
					const on = answer.skills.includes(skill.name);
					return (
						<li key={skill.name} className="grid gap-1.5">
							<label className="flex w-fit items-center gap-2 text-sm">
								<Checkbox checked={on} onCheckedChange={(checked) => toggle(skill.name, checked)} />
								{skill.name}
								<span className="text-[11px] text-ink-3">{skill.kind === "tool" ? t`tool` : t`skill`}</span>
							</label>
							{on && (
								<div className="ms-6 grid gap-2">
									<UsedAt
										label={t`Where did you use ${skill.name}?`}
										entries={entries}
										value={answer.places[skill.name] ?? []}
										onChange={(entryIds) => setPlaces(skill.name, entryIds)}
									/>
									<div className="flex items-center gap-2">
										<label htmlFor={`${id}-${skill.name}-level`} className="text-xs font-medium text-ink-2">
											<Trans>Level</Trans>
										</label>
										<NativeSelect
											id={`${id}-${skill.name}-level`}
											value={answer.levels[skill.name]?.toString() ?? ""}
											onChange={(event) => setLevel(skill.name, event.target.value ? Number(event.target.value) : null)}
											className="h-8 w-auto text-[13px]"
										>
											<option value="">{t`Not set`}</option>
											{[1, 2, 3, 4, 5].map((value) => (
												<option key={value} value={value}>
													{value}
												</option>
											))}
										</NativeSelect>
									</div>
								</div>
							)}
						</li>
					);
				})}
			</ul>
			{used.length > 0 && (
				<div className="grid gap-2">
					<Textarea
						aria-label={t`How you used it`}
						placeholder={t`Optional: what you did with it, in a sentence. It's added as an achievement.`}
						value={answer.note}
						onChange={(event) => onChange({ note: event.target.value })}
						className="min-h-14 text-[13px]"
					/>
					{answer.note.trim() && used.length > 1 && (
						<Where
							id={`${id}-where`}
							value={answer.entryId}
							entries={used}
							onChange={(entryId) => onChange({ entryId })}
							label={t`Add the achievement under`}
						/>
					)}
				</div>
			)}
		</li>
	);
}

function ExperienceGap({ applicationId, gap, answer, entries, onChange }: GapProps & { applicationId: string }) {
	const id = useId();
	const draft = useMutation({
		...orpc.masterProfile.gaps.draft.mutationOptions(),
		onSuccess: (data) => {
			onChange({ text: data.text });
			if (data.warning) toast.add({ description: data.warning });
		},
		onError: (error) => toastError(error, t`Couldn't draft the line. Write it yourself or try again.`),
	});
	return (
		<li className="grid gap-2 rounded-lg border border-line p-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<p className="min-w-0 flex-1 basis-64 text-[13px]">
					{gap.text}
					{gap.necessity === "mandatory" && <span className="ms-1.5 text-xs text-ink-3">{t`· required`}</span>}
				</p>
				<SegmentedControl
					aria-label={t`Have you done this?`}
					value={answer.have === null ? "" : answer.have ? "yes" : "no"}
					onValueChange={(value) => onChange({ have: value === "yes" })}
					className="h-8 w-fit shrink-0"
				>
					<SegmentedControlItem value="yes" className="px-3">
						<Trans>I've done this</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="no" className="px-3">
						<Trans>Not yet</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</div>
			{answer.have && (
				<div className="grid gap-2">
					<Where
						id={`${id}-where`}
						value={answer.entryId}
						entries={entries}
						onChange={(entryId) => onChange({ entryId })}
						label={t`Where did you do it?`}
					/>
					<Textarea
						aria-label={t`What you did`}
						placeholder={t`In your own words: what you did, for whom, and any result you know.`}
						value={answer.note}
						onChange={(event) => onChange({ note: event.target.value, text: "" })}
						className="min-h-16 text-[13px]"
					/>
					{answer.text ? (
						<div className="grid gap-1">
							<label htmlFor={`${id}-line`} className="text-xs font-medium text-ink-2">
								<Trans>Line to add to your profile</Trans>
							</label>
							<Textarea
								id={`${id}-line`}
								value={answer.text}
								onChange={(event) => onChange({ text: event.target.value })}
								className="min-h-12 text-[13px]"
							/>
						</div>
					) : (
						answer.note.trim().length >= 3 && (
							<Button
								size="sm"
								variant="secondary"
								className="w-fit"
								loading={draft.isPending}
								onClick={() =>
									draft.mutate({
										applicationId,
										requirementId: gap.requirementId,
										entryId: answer.entryId,
										note: answer.note,
									})
								}
							>
								<Icon name="sparkle" size={16} />
								<Trans>Turn it into a resume line</Trans>
							</Button>
						)
					)}
					{gap.skills.length > 0 && (
						<div className="flex flex-wrap gap-x-4 gap-y-2">
							{gap.skills.map(({ name }) => (
								<label key={name} className="flex items-center gap-2 text-xs text-ink-2">
									<Checkbox
										checked={answer.skills.includes(name)}
										onCheckedChange={(checked) =>
											onChange({
												skills: checked ? [...answer.skills, name] : answer.skills.filter((item) => item !== name),
												places: { ...answer.places, [name]: answer.entryId ? [answer.entryId] : [] },
											})
										}
									/>
									{t`Also add the skill ${name}`}
								</label>
							))}
						</div>
					)}
				</div>
			)}
		</li>
	);
}
