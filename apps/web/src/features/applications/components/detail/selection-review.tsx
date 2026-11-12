import type { RouterOutput } from "@/libs/orpc/client";
import type { PlanEntry, ResumeSelectionPlan, SelectionEdit } from "@reactive-resume/schema/resume-selection";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";

export type Selection = NonNullable<RouterOutput["masterProfile"]["selection"]["get"]>;

/** The full edit for a plan: every entry's include flag and achievement order, and every skill's include flag. */
export function editOf(plan: ResumeSelectionPlan): Omit<SelectionEdit, "applicationId"> {
	return {
		entries: plan.entries.map((entry) => ({
			entryId: entry.entryId,
			include: entry.include,
			achievements: entry.achievements.map((item) => ({ achievementId: item.achievementId, include: item.include })),
		})),
		skills: plan.skills.map((skill) => ({ skillId: skill.skillId, include: skill.include })),
	};
}

const statusStyle = {
	supported: { icon: "check-circle", className: "text-success-text", label: () => t`Supported` },
	partial: { icon: "circle-half", className: "text-warn-text", label: () => t`Partly supported` },
	gap: { icon: "warning-circle", className: "text-danger-text", label: () => t`No verified evidence` },
} as const;

const KIND_LABEL = () =>
	({
		position: t`Work experience`,
		project: t`Projects`,
		volunteer: t`Volunteer work`,
		education: t`Education`,
		certification: t`Certifications`,
		award: t`Awards`,
	}) as Record<PlanEntry["kind"], string>;

const period = (entry: Pick<PlanEntry, "startDate" | "endDate" | "kind">) =>
	entry.kind === "certification" || entry.kind === "award"
		? (entry.endDate ?? entry.startDate ?? "")
		: entry.startDate || entry.endDate
			? `${entry.startDate ?? "?"} – ${entry.endDate ?? t`present`}`
			: t`No dates`;

type SelectionReviewProps = {
	selection: Selection;
	saving: boolean;
	onChange: (edit: Omit<SelectionEdit, "applicationId">) => void;
};

/**
 * The proposed selection, for review before writing: the job's ranked requirements and whether each is backed,
 * then every entry of the profile with what's included, why, and in what order. Changes here never edit the
 * profile itself.
 */
export function SelectionReview({ selection, saving, onChange }: SelectionReviewProps) {
	const { analysis, plan } = selection;
	const requirementText = new Map(analysis.requirements.map((item) => [item.id, item.text]));
	const kinds = KIND_LABEL();
	const edit = editOf(plan);

	const setEntry = (entryId: string, change: (entry: (typeof edit.entries)[number]) => void) => {
		const next = structuredClone(edit);
		const entry = next.entries.find((item) => item.entryId === entryId);
		if (!entry) return;
		change(entry);
		onChange(next);
	};

	const groups = new Map<PlanEntry["kind"], PlanEntry[]>();
	for (const entry of plan.entries) groups.set(entry.kind, [...(groups.get(entry.kind) ?? []), entry]);
	const order: PlanEntry["kind"][] = ["position", "project", "volunteer", "education", "certification", "award"];

	return (
		<div className="grid gap-5" aria-busy={saving || undefined}>
			<section className="grid gap-1">
				<p className="text-sm">
					<span className="font-semibold">{analysis.title || t`This role`}</span>
					{analysis.employer ? ` · ${analysis.employer}` : ""}
					{analysis.seniority !== "unknown" ? ` · ${analysis.seniority}` : ""}
				</p>
				<p className="text-xs text-ink-3">
					{t`From your full record of ${plural(plan.totals.entries, { one: "# entry", other: "# entries" })} and ${plural(plan.totals.achievements, { one: "# achievement", other: "# achievements" })}, this resume uses ${plural(plan.totals.includedEntries, { one: "# entry", other: "# entries" })} and ${plural(plan.totals.includedAchievements, { one: "# achievement", other: "# achievements" })}.`}
				</p>
				{plan.positioning && <p className="text-[13px] text-ink-2">{plan.positioning}</p>}
			</section>

			<section className="grid gap-1.5" aria-labelledby="selection-requirements">
				<h4 id="selection-requirements" className="text-xs font-semibold text-ink-3">
					<Trans>What the posting needs, most important first</Trans>
				</h4>
				<ul className="grid gap-1">
					{analysis.requirements.map((requirement) => {
						const coverage = plan.coverage.find((item) => item.requirementId === requirement.id);
						const style = statusStyle[coverage?.status ?? "gap"];
						return (
							<li key={requirement.id} className="flex items-start gap-2 text-[13px]">
								<Icon name={style.icon} size={16} className={cn("mt-0.5 flex-none", style.className)} aria-hidden />
								<span className="grid flex-1 gap-0.5">
									<span>
										<span className="text-[11px] text-ink-3 tabular-nums">{requirement.id}</span> {requirement.text}
									</span>
									<span className="text-xs text-ink-3">
										{requirement.necessity === "mandatory" ? t`Required` : t`Preferred`}
										{requirement.origin === "inferred" ? ` · ${t`inferred from the duties`}` : ""}
										{` · ${t`importance ${requirement.importance} of 5`}`}
										{coverage?.status === "gap" && coverage.available.length > 0
											? ` · ${t`your profile has evidence that isn't included`}`
											: ""}
									</span>
								</span>
								<span className={cn("text-xs whitespace-nowrap", style.className)}>{style.label()}</span>
							</li>
						);
					})}
				</ul>
				{plan.coverage.some((item) => item.status === "gap") && (
					<p className="text-xs text-ink-3">
						<Trans>
							Nothing is written for a requirement without evidence. If you have done it, add it to your profile and
							propose again.
						</Trans>
					</p>
				)}
			</section>

			{(selection.postingChanged ||
				selection.profileChanged ||
				plan.warnings.length > 0 ||
				plan.unavailable.length > 0) && (
				<section className="grid gap-1 rounded-lg bg-sunken px-3 py-2 text-xs text-ink-2">
					{selection.postingChanged && (
						<p className="font-medium text-warn-text">
							<Trans>The posting changed since this was analysed. Analyse it again to update the requirements.</Trans>
						</p>
					)}
					{selection.profileChanged && (
						<p className="font-medium text-warn-text">
							<Trans>Your profile changed since this was proposed. Propose again to consider new records.</Trans>
						</p>
					)}
					{plan.warnings.map((warning) => (
						<p key={warning}>{warning}</p>
					))}
					{plan.unavailable.length > 0 && (
						<p>
							{plural(plan.unavailable.length, {
								one: "# record is hidden, switched off in Knowledge, or private to another application, so it wasn't considered.",
								other:
									"# records are hidden, switched off in Knowledge, or private to another application, so they weren't considered.",
							})}
						</p>
					)}
				</section>
			)}

			{order.map((kind) => {
				const entries = groups.get(kind);
				if (!entries?.length) return null;
				return (
					<section key={kind} className="grid gap-2" aria-label={kinds[kind]}>
						<h4 className="text-xs font-semibold text-ink-3">{kinds[kind]}</h4>
						{entries.map((entry) => (
							<EntryCard
								key={entry.entryId}
								entry={entry}
								requirementText={requirementText}
								onToggle={(include) => setEntry(entry.entryId, (item) => (item.include = include))}
								onAchievement={(achievementId, include) =>
									setEntry(entry.entryId, (item) => {
										const target = item.achievements.find((a) => a.achievementId === achievementId);
										if (target) target.include = include;
										// Newly included bullets go to the end of the included ones.
										const included = item.achievements.filter((a) => a.include && a !== target);
										const rest = item.achievements.filter((a) => !a.include && a !== target);
										if (target) item.achievements = [...included, target, ...rest];
									})
								}
								onMove={(achievementId, offset) =>
									setEntry(entry.entryId, (item) => {
										const index = item.achievements.findIndex((a) => a.achievementId === achievementId);
										const to = index + offset;
										const target = item.achievements[index];
										if (!target || to < 0 || to >= item.achievements.length || !item.achievements[to]?.include) return;
										item.achievements.splice(index, 1);
										item.achievements.splice(to, 0, target);
									})
								}
							/>
						))}
					</section>
				);
			})}

			{plan.skills.length > 0 && (
				<section className="grid gap-2" aria-labelledby="selection-skills">
					<h4 id="selection-skills" className="text-xs font-semibold text-ink-3">
						<Trans>Skills to list</Trans>
					</h4>
					<div className="flex flex-wrap gap-1.5">
						{plan.skills.map((skill) => (
							<button
								key={skill.skillId}
								type="button"
								aria-pressed={skill.include}
								title={skill.reason}
								onClick={() =>
									onChange({
										...edit,
										skills: edit.skills.map((item) =>
											item.skillId === skill.skillId ? { ...item, include: !item.include } : item,
										),
									})
								}
								className="flex h-7 items-center gap-1 rounded-md border border-line-2 px-2 text-xs text-ink-2 transition-colors duration-quick hover:bg-hover aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink"
							>
								{skill.include && <Icon name="check" size={13} />}
								{skill.name}
							</button>
						))}
					</div>
				</section>
			)}

			<p className="text-xs text-ink-3">
				<Trans>
					Leaving a position off this resume doesn't change your dates or your profile. When an application form asks
					for your full employment history, list every position.
				</Trans>
			</p>
		</div>
	);
}

type EntryCardProps = {
	entry: PlanEntry;
	requirementText: Map<string, string>;
	onToggle: (include: boolean) => void;
	onAchievement: (achievementId: string, include: boolean) => void;
	onMove: (achievementId: string, offset: number) => void;
};

function EntryCard({ entry, requirementText, onToggle, onAchievement, onMove }: EntryCardProps) {
	const id = useId();
	const [showAll, setShowAll] = useState(false);
	const included = entry.achievements.filter((item) => item.include);
	const shown = entry.include
		? showAll
			? entry.achievements
			: [...included, ...entry.achievements.filter((item) => !item.include).slice(0, included.length === 0 ? 3 : 0)]
		: [];
	const hiddenCount = entry.achievements.length - shown.length;

	return (
		<div
			className={cn(
				"grid gap-2 rounded-lg border px-3 py-2.5",
				entry.include ? "border-line-2" : "border-line bg-sunken/60",
			)}
		>
			<div className="flex items-start gap-2.5">
				<Checkbox
					className="mt-0.5"
					checked={entry.include}
					onCheckedChange={(value) => onToggle(value)}
					aria-labelledby={`${id}-title`}
				/>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<p id={`${id}-title`} className={cn("text-[13px] font-medium", !entry.include && "text-ink-2")}>
						{entry.title}
						{entry.organization ? ` · ${entry.organization}` : ""}
						<span className="font-normal text-ink-3"> · {period(entry)}</span>
					</p>
					<p className="text-xs text-ink-3">
						{entry.reason}
						{entry.userEdited ? ` · ${t`your choice`}` : ""}
						{entry.include && entry.achievements.length > 0
							? ` · ${t`${included.length} of ${entry.achievements.length} achievements`}`
							: ""}
					</p>
				</div>
			</div>

			{shown.length > 0 && (
				<ul className="grid gap-1 ps-7">
					{shown.map((item) => {
						const position = included.indexOf(item);
						return (
							<li key={item.achievementId} className="flex items-start gap-2">
								<Checkbox
									className="mt-0.5"
									checked={item.include}
									onCheckedChange={(value) => onAchievement(item.achievementId, value)}
									aria-labelledby={`${id}-${item.achievementId}`}
								/>
								<div className="grid min-w-0 flex-1 gap-0.5">
									<p id={`${id}-${item.achievementId}`} className={cn("text-[13px]", !item.include && "text-ink-2")}>
										{item.text}
									</p>
									<p className="text-xs text-ink-3">
										{item.reason}
										{item.requirementIds.length > 0 && (
											<span
												title={item.requirementIds.map((rid) => `${rid}: ${requirementText.get(rid) ?? ""}`).join("\n")}
											>
												{` · ${item.requirementIds.join(", ")}`}
											</span>
										)}
										{item.userEdited ? ` · ${t`your choice`}` : ""}
									</p>
								</div>
								{item.include && included.length > 1 && (
									<span className="flex flex-none">
										<IconButton
											icon="arrow-up"
											size="icon-xs"
											label={t`Move up`}
											disabled={position === 0}
											onClick={() => onMove(item.achievementId, -1)}
										/>
										<IconButton
											icon="arrow-down"
											size="icon-xs"
											label={t`Move down`}
											disabled={position === included.length - 1}
											onClick={() => onMove(item.achievementId, 1)}
										/>
									</span>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{entry.include && hiddenCount > 0 && (
				<button
					type="button"
					onClick={() => setShowAll((value) => !value)}
					className="justify-self-start ps-7 text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
				>
					{showAll
						? t`Show only the included achievements`
						: plural(hiddenCount, { one: "Show # more achievement", other: "Show # more achievements" })}
				</button>
			)}
		</div>
	);
}
