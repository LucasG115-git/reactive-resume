import type { RouterOutput } from "@/libs/orpc/client";
import type { ProfileEntryKind, ProfileMetric } from "@reactive-resume/schema/master-profile";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { PROFILE_ENTRY_KINDS } from "@reactive-resume/schema/master-profile";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError, CareerLoading } from "../load-state";
import { withUndo } from "../shared";
import { ProfileFileImport } from "./profile-file";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type MasterProfile = RouterOutput["masterProfile"]["get"];
type Entry = MasterProfile["entries"][number];
type Achievement = Entry["achievements"][number];
type Skill = MasterProfile["skills"][number];

const kindLabel = (kind: ProfileEntryKind, count = 1) =>
	({
		position: plural(count, { one: "Position", other: "Experience" }),
		project: plural(count, { one: "Project", other: "Projects" }),
		education: t`Education`,
		volunteer: plural(count, { one: "Volunteer role", other: "Volunteering" }),
		certification: plural(count, { one: "Certification", other: "Certifications" }),
		award: plural(count, { one: "Award", other: "Awards" }),
	})[kind];

const kindIcon: Record<ProfileEntryKind, IconName> = {
	position: "briefcase",
	project: "squares-four",
	education: "graduation-cap",
	volunteer: "hand-heart",
	certification: "seal-check",
	award: "star",
};

/** "a, b ,c" → ["a", "b", "c"], dropping blanks and repeats. */
export function splitList(value: string): string[] {
	return [
		...new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}

/** "2019-03" → "Mar 2019"; "2019" stays "2019". */
export function formatProfileDate(value: string | null, locale?: string) {
	if (!value) return "";
	const [year, month] = value.split("-");
	if (!month) return year ?? "";
	return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(locale, { month: "short", year: "numeric" });
}

function dateRange(entry: Pick<Entry, "startDate" | "endDate">) {
	const start = formatProfileDate(entry.startDate);
	const end = entry.endDate ? formatProfileDate(entry.endDate) : start ? t`Present` : "";
	if (!start) return end;
	return start === end ? start : `${start} – ${end}`;
}

export function ProfilePage() {
	const queryClient = useQueryClient();
	const query = useQuery(orpc.masterProfile.get.queryOptions());
	const [adding, setAdding] = useState<ProfileEntryKind | null>(null);
	const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.masterProfile.key() });

	if (!query.data) return query.isError ? <CareerLoadError onRetry={() => void query.refetch()} /> : <CareerLoading />;
	const profile = query.data;
	const achievementCount =
		profile.standalone.length + profile.entries.reduce((sum, entry) => sum + entry.achievements.length, 0);

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
				<Icon name="user-circle" size={20} className="text-ink-2" />
				<div className="grid min-w-0 flex-1 basis-56 gap-px">
					<p className="text-sm font-semibold">
						<Trans>Master profile</Trans>
					</p>
					<p className="text-xs text-ink-3">
						<Trans>
							Your verified career record. Tailored resumes are assembled from these entries, achievements and skills,
							so keep each claim accurate and add numbers only when you can back them up.
						</Trans>
					</p>
				</div>
				<p className="font-mono text-xs text-ink-3">
					{plural(profile.entries.length, { one: "# entry", other: "# entries" })} ·{" "}
					{plural(achievementCount, { one: "# achievement", other: "# achievements" })} ·{" "}
					{plural(profile.skills.length, { one: "# skill", other: "# skills" })}
				</p>
			</div>

			<ProfileFileImport onImported={refresh} />
			<ImportFromResume onImported={refresh} />

			<section className="grid gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="flex-1 text-base font-semibold">
						<Trans>Experience, projects and education</Trans>
					</h2>
					<div className="w-auto">
						<NativeSelect
							aria-label={t`Add an entry`}
							value=""
							onChange={(event) => setAdding(event.target.value as ProfileEntryKind)}
							className="h-8 text-[13px] font-medium"
						>
							<option value="" disabled>
								{t`Add…`}
							</option>
							{PROFILE_ENTRY_KINDS.map((kind) => (
								<option key={kind} value={kind}>
									{kindLabel(kind)}
								</option>
							))}
						</NativeSelect>
					</div>
				</div>

				{adding && (
					<EntryEditor
						kind={adding}
						onCancel={() => setAdding(null)}
						onSaved={() => {
							setAdding(null);
							refresh();
						}}
					/>
				)}

				{profile.entries.length === 0 && !adding && (
					<div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-line-2 p-6 text-center text-sm text-ink-3">
						<Trans>No entries yet. Start with your current or most recent role.</Trans>
						<Button variant="secondary" size="sm" onClick={() => setAdding("position")}>
							<Trans>Add a position</Trans>
						</Button>
					</div>
				)}

				{PROFILE_ENTRY_KINDS.map((kind) => {
					const entries = profile.entries.filter((entry) => entry.kind === kind);
					if (entries.length === 0) return null;
					return (
						<div key={kind} className="grid gap-2">
							<h3 className="flex items-center gap-2 font-mono text-xs font-medium tracking-wide text-ink-3 uppercase">
								<Icon name={kindIcon[kind]} size={16} />
								{kindLabel(kind, entries.length)}
							</h3>
							{entries.map((entry) => (
								<EntryCard key={entry.id} entry={entry} onChanged={refresh} />
							))}
						</div>
					);
				})}

				{profile.standalone.length > 0 && (
					<div className="grid gap-2">
						<h3 className="font-mono text-xs font-medium tracking-wide text-ink-3 uppercase">
							<Trans>Other achievements</Trans>
						</h3>
						<div className="overflow-hidden rounded-xl border border-line bg-surface">
							{profile.standalone.map((achievement) => (
								<AchievementRow key={achievement.id} achievement={achievement} onChanged={refresh} />
							))}
						</div>
					</div>
				)}
			</section>

			<SkillsSection skills={profile.skills} onChanged={refresh} />
		</div>
	);
}

// ---- Import ----

type ImportFromResumeProps = { onImported: () => void };

/** Copies a resume's history into the profile. Shown on every visit: it's safe to rerun and skips duplicates. */
function ImportFromResume({ onImported }: ImportFromResumeProps) {
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const resumes = (documents ?? []).filter((document) => document.type === "resume");
	const [resumeId, setResumeId] = useState("");
	const chosen = resumeId || resumes[0]?.id || "";
	const run = useMutation({
		...orpc.masterProfile.importFromResume.mutationOptions(),
		onSuccess: (counts) => {
			onImported();
			const total = counts.entries + counts.achievements + counts.skills;
			toast.add({
				type: "success",
				description:
					total === 0
						? t`Nothing new in that resume. Your profile already has it.`
						: t`Added ${counts.entries} entries, ${counts.achievements} achievements and ${counts.skills} skills. Review them, add numbers you can back up, and hide anything you don't want used.`,
			});
		},
		onError: (error) => toastError(error, t`Couldn't import that resume. Try again.`),
	});
	if (resumes.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-2 py-1.5 ps-3.5 pe-1.5">
			<Icon name="download-simple" size={20} className="text-ink-3" />
			<span className="min-w-0 flex-1 basis-48 text-[13px] text-ink-2">
				<Trans>Fill your profile from a resume you already have</Trans>
			</span>
			<div className="w-auto">
				<NativeSelect
					aria-label={t`Resume to import`}
					value={chosen}
					onChange={(event) => setResumeId(event.target.value)}
					className="h-8 max-w-56 text-[13px]"
				>
					{resumes.map((resume) => (
						<option key={resume.id} value={resume.id}>
							{resume.name}
						</option>
					))}
				</NativeSelect>
			</div>
			<Button
				variant="secondary"
				size="sm"
				className="h-8"
				loading={run.isPending}
				onClick={() => chosen && run.mutate({ resumeId: chosen })}
			>
				<Trans>Import</Trans>
			</Button>
		</div>
	);
}

// ---- Entries ----

type EntryCardProps = { entry: Entry; onChanged: () => void };

function EntryCard({ entry, onChanged }: EntryCardProps) {
	const [editing, setEditing] = useState(false);
	const [gone, setGone] = useState(false);
	if (gone) return null;
	if (editing) {
		return (
			<EntryEditor
				kind={entry.kind}
				entry={entry}
				onCancel={() => setEditing(false)}
				onSaved={() => {
					setEditing(false);
					onChanged();
				}}
			/>
		);
	}

	const remove = () => {
		setGone(true);
		withUndo({
			description: t`Entry deleted`,
			onUndo: () => setGone(false),
			commit: () =>
				client.masterProfile
					.deleteEntry({ id: entry.id })
					.catch((error: unknown) => {
						setGone(false);
						toastError(error, t`Couldn't delete that entry. Try again.`);
					})
					.finally(onChanged),
		});
	};

	const subtitle = [entry.organization, entry.location].filter(Boolean).join(" · ");
	return (
		<article className={cn("overflow-hidden rounded-xl border border-line bg-surface", entry.hidden && "opacity-60")}>
			<header className="flex items-start gap-3 border-b border-line px-4 py-3">
				<div className="grid min-w-0 flex-1 gap-0.5">
					<p className="text-sm font-semibold">
						{entry.title}
						{entry.hidden && (
							<span className="ms-2 rounded-lg bg-sunken px-1.5 text-[11px] font-normal text-ink-3">
								<Trans>Hidden from resumes</Trans>
							</span>
						)}
					</p>
					{subtitle && <p className="text-[13px] text-ink-2">{subtitle}</p>}
					{entry.summary && <p className="text-[13px] text-pretty text-ink-3">{entry.summary}</p>}
					{entry.tags.length > 0 && <Chips items={entry.tags} />}
				</div>
				<div className="grid justify-items-end gap-1">
					<span className="font-mono text-xs whitespace-nowrap text-ink-3">{dateRange(entry)}</span>
					<div className="flex gap-0.5">
						<RowAction icon="pencil-simple" label={t`Edit ${entry.title}`} onClick={() => setEditing(true)} />
						<RowAction icon="trash" label={t`Delete ${entry.title}`} onClick={remove} />
					</div>
				</div>
			</header>
			{entry.achievements.map((achievement) => (
				<AchievementRow key={achievement.id} achievement={achievement} onChanged={onChanged} />
			))}
			<AddAchievement entryId={entry.id} onAdded={onChanged} />
		</article>
	);
}

type EntryEditorProps = {
	kind: ProfileEntryKind;
	entry?: Entry | undefined;
	onCancel: () => void;
	onSaved: () => void;
};

function EntryEditor({ kind: initialKind, entry, onCancel, onSaved }: EntryEditorProps) {
	const formId = useId();
	const [kind, setKind] = useState<ProfileEntryKind>(entry?.kind ?? initialKind);
	const [title, setTitle] = useState(entry?.title ?? "");
	const [organization, setOrganization] = useState(entry?.organization ?? "");
	const [location, setLocation] = useState(entry?.location ?? "");
	const [url, setUrl] = useState(entry?.url ?? "");
	const [startDate, setStartDate] = useState(entry?.startDate ?? "");
	const [endDate, setEndDate] = useState(entry?.endDate ?? "");
	const [summary, setSummary] = useState(entry?.summary ?? "");
	const [tags, setTags] = useState(entry?.tags.join(", ") ?? "");
	const [hidden, setHidden] = useState(entry?.hidden ?? false);

	const save = useMutation({
		...orpc.masterProfile.saveEntry.mutationOptions(),
		onSuccess: onSaved,
		onError: (error) => toastError(error, t`Couldn't save that entry. Check the dates and try again.`),
	});

	const organizationLabel = {
		position: t`Employer`,
		project: t`Client or organization`,
		education: t`School`,
		volunteer: t`Organization`,
		certification: t`Issuer`,
		award: t`Awarded by`,
	}[kind];
	const titleLabel = {
		position: t`Job title`,
		project: t`Project name`,
		education: t`Degree or program`,
		volunteer: t`Role`,
		certification: t`Certification`,
		award: t`Award`,
	}[kind];

	return (
		<form
			aria-label={entry ? t`Edit entry` : t`New entry`}
			className="grid gap-3 rounded-xl border border-accent bg-surface p-4 shadow-[0_0_0_3px_var(--accent-soft)]"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate({
					...(entry ? { id: entry.id } : {}),
					kind,
					title,
					organization,
					location,
					url,
					startDate: startDate.trim() || null,
					endDate: endDate.trim() || null,
					summary,
					tags: splitList(tags),
					hidden,
				});
			}}
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field id={`${formId}-kind`} label={t`Type`}>
					<NativeSelect
						id={`${formId}-kind`}
						value={kind}
						onChange={(e) => setKind(e.target.value as ProfileEntryKind)}
					>
						{PROFILE_ENTRY_KINDS.map((option) => (
							<option key={option} value={option}>
								{kindLabel(option)}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field id={`${formId}-title`} label={titleLabel}>
					<Input
						id={`${formId}-title`}
						required
						maxLength={200}
						value={title}
						onChange={(e) => setTitle(e.target.value)}
					/>
				</Field>
				<Field id={`${formId}-org`} label={organizationLabel}>
					<Input
						id={`${formId}-org`}
						maxLength={200}
						value={organization}
						onChange={(e) => setOrganization(e.target.value)}
					/>
				</Field>
				<Field id={`${formId}-location`} label={t`Location`}>
					<Input
						id={`${formId}-location`}
						maxLength={200}
						value={location}
						onChange={(e) => setLocation(e.target.value)}
					/>
				</Field>
				<Field id={`${formId}-start`} label={t`Start (YYYY or YYYY-MM)`}>
					<Input
						id={`${formId}-start`}
						inputMode="numeric"
						pattern="\d{4}(-(0[1-9]|1[0-2]))?"
						placeholder="2021-04"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
					/>
				</Field>
				<Field id={`${formId}-end`} label={t`End (blank if current)`}>
					<Input
						id={`${formId}-end`}
						inputMode="numeric"
						pattern="\d{4}(-(0[1-9]|1[0-2]))?"
						placeholder={t`Present`}
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
					/>
				</Field>
			</div>
			<Field id={`${formId}-summary`} label={t`Summary (scope, team size, what the role was for)`}>
				<Textarea
					id={`${formId}-summary`}
					rows={2}
					maxLength={2000}
					value={summary}
					onChange={(e) => setSummary(e.target.value)}
					className="px-3 py-2"
				/>
			</Field>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field id={`${formId}-tags`} label={t`Tags, comma separated`}>
					<Input
						id={`${formId}-tags`}
						placeholder={t`nonprofit, wordpress, leadership`}
						value={tags}
						onChange={(e) => setTags(e.target.value)}
					/>
				</Field>
				<Field id={`${formId}-url`} label={t`Link (optional)`}>
					<Input id={`${formId}-url`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
				</Field>
			</div>
			<FormFooter
				hidden={hidden}
				onHidden={setHidden}
				pending={save.isPending}
				onCancel={onCancel}
				submitLabel={entry ? t`Save entry` : t`Add entry`}
			/>
		</form>
	);
}

// ---- Achievements ----

type AchievementRowProps = { achievement: Achievement; onChanged: () => void };

function AchievementRow({ achievement, onChanged }: AchievementRowProps) {
	const [editing, setEditing] = useState(false);
	const [gone, setGone] = useState(false);
	if (gone) return null;
	if (editing) {
		return (
			<AchievementEditor
				entryId={achievement.entryId}
				achievement={achievement}
				onCancel={() => setEditing(false)}
				onSaved={() => {
					setEditing(false);
					onChanged();
				}}
			/>
		);
	}

	const remove = () => {
		setGone(true);
		withUndo({
			description: t`Achievement deleted`,
			onUndo: () => setGone(false),
			commit: () =>
				client.masterProfile
					.deleteAchievement({ id: achievement.id })
					.catch((error: unknown) => {
						setGone(false);
						toastError(error, t`Couldn't delete that achievement. Try again.`);
					})
					.finally(onChanged),
		});
	};
	const excerpt = achievement.text.length > 40 ? `${achievement.text.slice(0, 40)}…` : achievement.text;

	return (
		<div
			className={cn(
				"flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0",
				achievement.hidden && "opacity-60",
			)}
		>
			<Icon
				name={achievement.core ? "star" : "circle"}
				size={14}
				className={cn("mt-1 flex-none", achievement.core ? "text-accent" : "text-ink-3")}
				aria-label={achievement.core ? t`Always included` : undefined}
			/>
			<div className="grid min-w-0 flex-1 gap-1.5">
				<p className="text-sm leading-[21px] text-pretty">{achievement.text}</p>
				{(achievement.metrics.length > 0 || achievement.skills.length > 0 || achievement.tags.length > 0) && (
					<div className="flex flex-wrap gap-1">
						{achievement.metrics.map((metric, index) => (
							<span
								// Metrics have no ids; their order is stable between saves.
								// oxlint-disable-next-line react/no-array-index-key -- metrics are a value list without ids
								key={index}
								className="h-[20px] rounded-lg bg-accent-soft px-1.5 font-mono text-[11px] leading-[20px] text-accent-text"
							>
								{metricLabel(metric)}
							</span>
						))}
						<Chips items={achievement.skills} tone="info" />
						<Chips items={achievement.tags} />
					</div>
				)}
				{achievement.variants.length > 0 && (
					<p className="text-xs text-ink-3">
						{plural(achievement.variants.length, { one: "# approved variant", other: "# approved variants" })}
					</p>
				)}
			</div>
			<div className="flex flex-none gap-0.5">
				<RowAction icon="pencil-simple" label={t`Edit: ${excerpt}`} onClick={() => setEditing(true)} />
				<RowAction icon="trash" label={t`Delete: ${excerpt}`} onClick={remove} />
			</div>
		</div>
	);
}

export function metricLabel(metric: ProfileMetric) {
	return [`${metric.value}${metric.unit}`, metric.label].filter(Boolean).join(" ");
}

type AddAchievementProps = { entryId: string | null; onAdded: () => void };

function AddAchievement({ entryId, onAdded }: AddAchievementProps) {
	const [open, setOpen] = useState(false);
	if (open) {
		return (
			<AchievementEditor
				entryId={entryId}
				onCancel={() => setOpen(false)}
				onSaved={() => {
					setOpen(false);
					onAdded();
				}}
			/>
		);
	}
	return (
		<button
			type="button"
			onClick={() => setOpen(true)}
			className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-[13px] font-medium text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink"
		>
			<Icon name="plus" size={16} />
			<Trans>Add achievement</Trans>
		</button>
	);
}

type AchievementEditorProps = {
	entryId: string | null;
	achievement?: Achievement | undefined;
	onCancel: () => void;
	onSaved: () => void;
};

type MetricDraft = { value: string; unit: string; label: string };

function AchievementEditor({ entryId, achievement, onCancel, onSaved }: AchievementEditorProps) {
	const formId = useId();
	const [text, setText] = useState(achievement?.text ?? "");
	const [metrics, setMetrics] = useState<MetricDraft[]>(achievement?.metrics ?? []);
	const [skills, setSkills] = useState(achievement?.skills.join(", ") ?? "");
	const [tags, setTags] = useState(achievement?.tags.join(", ") ?? "");
	const [variants, setVariants] = useState(achievement?.variants.join("\n") ?? "");
	const [core, setCore] = useState(achievement?.core ?? false);
	const [hidden, setHidden] = useState(achievement?.hidden ?? false);

	const save = useMutation({
		...orpc.masterProfile.saveAchievement.mutationOptions(),
		onSuccess: onSaved,
		onError: (error) => toastError(error, t`Couldn't save that achievement. Try again.`),
	});
	const setMetric = (index: number, values: Partial<MetricDraft>) =>
		setMetrics((list) => list.map((metric, i) => (i === index ? { ...metric, ...values } : metric)));

	return (
		<form
			aria-label={achievement ? t`Edit achievement` : t`New achievement`}
			className="grid gap-3 border-b border-line bg-sunken/40 px-4 py-3 last:border-b-0"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate({
					...(achievement ? { id: achievement.id } : {}),
					entryId,
					text,
					metrics: metrics.filter((metric) => metric.value.trim()),
					skills: splitList(skills),
					tags: splitList(tags),
					variants: variants
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean),
					core,
					hidden,
				});
			}}
		>
			<Field id={`${formId}-text`} label={t`What you did and what changed, as a resume bullet`}>
				<Textarea
					id={`${formId}-text`}
					required
					rows={2}
					maxLength={1000}
					autoFocus
					placeholder={t`Rebuilt the volunteer portal on WordPress, cutting coordinator admin time by 40%`}
					value={text}
					onChange={(e) => setText(e.target.value)}
					className="px-3 py-2"
				/>
			</Field>

			<fieldset className="grid gap-2">
				<legend className="mb-1 text-xs font-medium text-ink-2">
					<Trans>Metrics (only numbers you can back up)</Trans>
				</legend>
				{metrics.map((metric, index) => (
					// oxlint-disable-next-line react/no-array-index-key -- draft rows without ids
					<div key={index} className="flex flex-wrap gap-2">
						<Input
							aria-label={t`Value`}
							placeholder="40"
							className="w-20"
							value={metric.value}
							onChange={(e) => setMetric(index, { value: e.target.value })}
						/>
						<Input
							aria-label={t`Unit`}
							placeholder="%"
							className="w-20"
							value={metric.unit}
							onChange={(e) => setMetric(index, { unit: e.target.value })}
						/>
						<Input
							aria-label={t`What was measured`}
							placeholder={t`less admin time`}
							className="min-w-40 flex-1"
							value={metric.label}
							onChange={(e) => setMetric(index, { label: e.target.value })}
						/>
						<RowAction
							icon="x"
							label={t`Remove metric`}
							onClick={() => setMetrics((list) => list.filter((_, i) => i !== index))}
						/>
					</div>
				))}
				{metrics.length < 10 && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="w-fit text-ink-2"
						onClick={() => setMetrics((list) => [...list, { value: "", unit: "", label: "" }])}
					>
						<Icon name="plus" size={14} />
						<Trans>Add metric</Trans>
					</Button>
				)}
			</fieldset>

			<div className="grid gap-3 sm:grid-cols-2">
				<Field id={`${formId}-skills`} label={t`Skills shown, comma separated`}>
					<Input
						id={`${formId}-skills`}
						placeholder="WordPress, UX research"
						value={skills}
						onChange={(e) => setSkills(e.target.value)}
					/>
				</Field>
				<Field id={`${formId}-tags`} label={t`Themes, comma separated`}>
					<Input
						id={`${formId}-tags`}
						placeholder={t`stakeholder management, nonprofit`}
						value={tags}
						onChange={(e) => setTags(e.target.value)}
					/>
				</Field>
			</div>
			<Field id={`${formId}-variants`} label={t`Approved alternative wordings, one per line (optional)`}>
				<Textarea
					id={`${formId}-variants`}
					rows={2}
					value={variants}
					onChange={(e) => setVariants(e.target.value)}
					className="px-3 py-2"
				/>
			</Field>
			<SwitchRow
				checked={core}
				onCheckedChange={setCore}
				label={t`Always include`}
				description={t`Keep this achievement whenever its entry is on a resume.`}
				className="w-fit max-w-full"
			/>
			<FormFooter
				hidden={hidden}
				onHidden={setHidden}
				pending={save.isPending}
				onCancel={onCancel}
				submitLabel={achievement ? t`Save achievement` : t`Add achievement`}
			/>
		</form>
	);
}

// ---- Skills ----

type SkillsSectionProps = { skills: Skill[]; onChanged: () => void };

function SkillsSection({ skills, onChanged }: SkillsSectionProps) {
	const [editing, setEditing] = useState<Skill | "new" | null>(null);
	const groups = new Map<string, Skill[]>();
	for (const skill of skills) {
		const category = skill.category || t`Uncategorized`;
		groups.set(category, [...(groups.get(category) ?? []), skill]);
	}
	const categories = [...new Set(skills.map((skill) => skill.category).filter(Boolean))];

	const remove = (skill: Skill) =>
		client.masterProfile
			.deleteSkill({ id: skill.id })
			.catch((error: unknown) => toastError(error, t`Couldn't delete that skill. Try again.`))
			.finally(onChanged);

	return (
		<section className="grid gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="flex-1 text-base font-semibold">
					<Trans>Skills</Trans>
				</h2>
				<Button variant="secondary" size="sm" onClick={() => setEditing("new")}>
					<Icon name="plus" size={16} />
					<Trans>Add skill</Trans>
				</Button>
			</div>
			{editing && (
				<SkillEditor
					skill={editing === "new" ? undefined : editing}
					categories={categories}
					onCancel={() => setEditing(null)}
					onSaved={() => {
						setEditing(null);
						onChanged();
					}}
				/>
			)}
			{skills.length === 0 && !editing && (
				<p className="rounded-xl border border-dashed border-line-2 p-4 text-center text-sm text-ink-3">
					<Trans>No skills yet. Add the tools and abilities you'd want a recruiter to search for.</Trans>
				</p>
			)}
			{[...groups].map(([category, list]) => (
				<div key={category} className="grid gap-1.5">
					<h3 className="font-mono text-xs font-medium tracking-wide text-ink-3 uppercase">{category}</h3>
					<div className="flex flex-wrap gap-1.5">
						{list.map((skill) => (
							<span
								key={skill.id}
								className={cn(
									"flex h-8 items-center gap-1 rounded-lg border border-line bg-surface ps-2.5 pe-1 text-[13px]",
									skill.hidden && "opacity-60",
								)}
							>
								<button type="button" className="hover:underline" onClick={() => setEditing(skill)}>
									{skill.name}
								</button>
								{skill.level !== null && (
									<span className="font-mono text-[11px] text-ink-3" aria-label={t`Level ${skill.level} of 5`}>
										{skill.level}/5
									</span>
								)}
								<RowAction icon="x" label={t`Delete ${skill.name}`} onClick={() => void remove(skill)} />
							</span>
						))}
					</div>
				</div>
			))}
		</section>
	);
}

type SkillEditorProps = { skill?: Skill | undefined; categories: string[]; onCancel: () => void; onSaved: () => void };

function SkillEditor({ skill, categories, onCancel, onSaved }: SkillEditorProps) {
	const formId = useId();
	const [name, setName] = useState(skill?.name ?? "");
	const [category, setCategory] = useState(skill?.category ?? "");
	const [level, setLevel] = useState(skill?.level?.toString() ?? "");
	const [years, setYears] = useState(skill?.years?.toString() ?? "");
	const [aliases, setAliases] = useState(skill?.aliases.join(", ") ?? "");
	const [hidden, setHidden] = useState(skill?.hidden ?? false);
	const save = useMutation({
		...orpc.masterProfile.saveSkill.mutationOptions(),
		onSuccess: onSaved,
		onError: (error) => toastError(error, t`Couldn't save that skill. Try again.`),
	});

	return (
		<form
			aria-label={skill ? t`Edit skill` : t`New skill`}
			className="grid gap-3 rounded-xl border border-accent bg-surface p-4 shadow-[0_0_0_3px_var(--accent-soft)]"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate({
					...(skill ? { id: skill.id } : {}),
					name,
					category,
					level: level ? Number(level) : null,
					years: years ? Number(years) : null,
					aliases: splitList(aliases),
					hidden,
				});
			}}
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field id={`${formId}-name`} label={t`Skill`}>
					<Input
						id={`${formId}-name`}
						required
						autoFocus
						maxLength={100}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</Field>
				<Field id={`${formId}-category`} label={t`Category`}>
					<Input
						id={`${formId}-category`}
						list={`${formId}-categories`}
						maxLength={100}
						placeholder={t`Web development`}
						value={category}
						onChange={(e) => setCategory(e.target.value)}
					/>
					<datalist id={`${formId}-categories`}>
						{categories.map((option) => (
							<option key={option} value={option} />
						))}
					</datalist>
				</Field>
				<Field id={`${formId}-level`} label={t`Level (optional)`}>
					<NativeSelect id={`${formId}-level`} value={level} onChange={(e) => setLevel(e.target.value)}>
						<option value="">{t`Not set`}</option>
						{[1, 2, 3, 4, 5].map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field id={`${formId}-years`} label={t`Years (optional)`}>
					<Input
						id={`${formId}-years`}
						type="number"
						min={0}
						max={60}
						step={0.5}
						value={years}
						onChange={(e) => setYears(e.target.value)}
					/>
				</Field>
			</div>
			<Field id={`${formId}-aliases`} label={t`Other names postings use, comma separated`}>
				<Input
					id={`${formId}-aliases`}
					placeholder="JS, ECMAScript"
					value={aliases}
					onChange={(e) => setAliases(e.target.value)}
				/>
			</Field>
			<FormFooter
				hidden={hidden}
				onHidden={setHidden}
				pending={save.isPending}
				onCancel={onCancel}
				submitLabel={skill ? t`Save skill` : t`Add skill`}
			/>
		</form>
	);
}

// ---- Bits ----

type FieldProps = { id: string; label: string; children: ReactNode };

function Field({ id, label, children }: FieldProps) {
	return (
		<div className="grid gap-1">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			{children}
		</div>
	);
}

type FormFooterProps = {
	hidden: boolean;
	onHidden: (hidden: boolean) => void;
	pending: boolean;
	onCancel: () => void;
	submitLabel: string;
};

function FormFooter({ hidden, onHidden, pending, onCancel, submitLabel }: FormFooterProps) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<SwitchRow
				checked={hidden}
				onCheckedChange={onHidden}
				label={t`Hide from resumes`}
				className="w-auto flex-1 py-0"
			/>
			<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
				<Trans>Cancel</Trans>
			</Button>
			<Button type="submit" variant="secondary" size="sm" loading={pending}>
				{submitLabel}
			</Button>
		</div>
	);
}

type ChipsProps = { items: string[]; tone?: "neutral" | "info" };

function Chips({ items, tone = "neutral" }: ChipsProps) {
	if (items.length === 0) return null;
	return (
		<span className="flex flex-wrap gap-1">
			{items.map((item) => (
				<span
					key={item}
					className={cn(
						"h-[20px] rounded-lg px-1.5 text-[11px] leading-[20px]",
						tone === "info" ? "bg-info-soft text-info-text" : "bg-sunken text-ink-2",
					)}
				>
					{item}
				</span>
			))}
		</span>
	);
}

type RowActionProps = { icon: IconName; label: string; onClick: () => void };

function RowAction({ icon, label, onClick }: RowActionProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="touch-target relative grid size-7 place-items-center rounded-sm text-ink-3 transition-colors duration-quick hover:bg-hover hover:text-ink"
		>
			<Icon name={icon} size={16} />
		</button>
	);
}
