import type { Application } from "../../types";
import type { RouterOutput } from "@/libs/orpc/client";
import type { AssembleMode } from "@reactive-resume/schema/master-profile";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { choosePreset } from "@reactive-resume/schema/resume-style";
import { pagesFor, yearsSinceFirstRole } from "@reactive-resume/schema/resume-writing";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";
import { useInvalidateApplications } from "../../use-application-actions";
import { RenderingPanel, ReviewPanel } from "./assembly-review";
import { BuildProgress } from "./build-progress";
import { GapStep, MatchBar } from "./gap-step";
import { SelectionReview } from "./selection-review";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type AssembleResult = RouterOutput["masterProfile"]["assemble"];

type AssembleDialogProps = {
	application: Application;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Start analysing as soon as it opens, when there's no selection yet (after "Save and build resume"). */
	autoPropose?: boolean | undefined;
};

/**
 * Tailoring a resume for this job, in three steps: propose which profile records to use (job analysis and
 * evidence selection), review that selection, then build the resume from it.
 */
export function AssembleDialog({ application, open, onOpenChange, autoPropose }: AssembleDialogProps) {
	const formId = useId();
	const queryClient = useQueryClient();
	const [step, setStep] = useState<"select" | "build">("select");
	const selectionOptions = orpc.masterProfile.selection.get.queryOptions({ input: { applicationId: application.id } });
	const selection = useQuery({ ...selectionOptions, enabled: open });
	const saveSelection = (data: Awaited<ReturnType<typeof orpc.masterProfile.selection.get.call>>) =>
		queryClient.setQueryData(selectionOptions.queryKey, data);
	const propose = useMutation({
		...orpc.masterProfile.selection.propose.mutationOptions(),
		onSuccess: saveSelection,
		onError: (error) => toastError(error, t`Couldn't analyse the posting. Try again.`),
	});
	const update = useMutation({
		...orpc.masterProfile.selection.update.mutationOptions(),
		onSuccess: saveSelection,
		onError: (error) => {
			void selection.refetch();
			toastError(error, t`Couldn't save your selection. Try again.`);
		},
	});
	const reset = useMutation({
		...orpc.masterProfile.selection.reset.mutationOptions(),
		onSuccess: saveSelection,
		onError: (error) => toastError(error, t`Couldn't restore the proposal. Try again.`),
	});
	// Standard unless the user set Thorough as their default or chooses it here; Thorough needs its own model.
	const taskSettings = useQuery({ ...orpc.aiTasks.get.queryOptions(), enabled: open, retry: false });
	const thoroughReady = Boolean(taskSettings.data?.thorough.model || taskSettings.data?.thorough.providerId);
	const [reviewDraft, setReviewDraft] = useState(true);
	const [qualityChoice, setQualityChoice] = useState<Quality | null>(null);
	const quality: Quality = thoroughReady ? (qualityChoice ?? taskSettings.data?.quality ?? "standard") : "standard";
	const qualityControl = thoroughReady ? (
		<QualityChoice id={`${formId}-quality`} value={quality} onChange={setQualityChoice} />
	) : null;
	const current = selection.data ?? null;
	// What the posting asks for that the profile shows nowhere: asked about once, before the selection review.
	const gapsOptions = orpc.masterProfile.gaps.get.queryOptions({ input: { applicationId: application.id } });
	const gaps = useQuery({ ...gapsOptions, enabled: open && Boolean(current) });
	const [gapsDone, setGapsDone] = useState(false);
	const askingGaps = !gapsDone && Boolean(current) && (gaps.data?.gaps.some((gap) => gap.answer === null) ?? false);
	const started = useRef(false);
	useEffect(() => {
		if (!autoPropose || !open || started.current || selection.isPending || taskSettings.isPending || selection.data)
			return;
		if (!application.jobDescription?.trim() && application.requirements.length === 0) return;
		started.current = true;
		propose.mutate({ applicationId: application.id, quality });
	}, [quality, taskSettings.isPending, autoPropose, open, selection.isPending, selection.data, application, propose]);
	const edited = Boolean(
		current &&
		(current.plan.entries.some((entry) => entry.userEdited || entry.achievements.some((item) => item.userEdited)) ||
			current.plan.skills.some((skill) => skill.userEdited)),
	);
	const invalidate = useInvalidateApplications();
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const profile = useQuery({ ...orpc.masterProfile.get.queryOptions(), enabled: open });

	// General resumes (not made for a job) first, newest first: the usual starting point for contact details and design.
	const resumes = (documents ?? [])
		.filter((document) => document.type === "resume")
		.toSorted(
			(a, b) =>
				Number(Boolean(a.application)) - Number(Boolean(b.application)) ||
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);
	const [baseResumeId, setBaseResumeId] = useState<string | null>(null);
	// "" starts from the default template with the account's name and email.
	const base = baseResumeId ?? resumes[0]?.id ?? "";
	const [mode, setMode] = useState<AssembleMode>("rephrase");
	const styleGuide = useQuery({ ...orpc.resumeStyle.get.queryOptions(), enabled: open });
	const [presetId, setPresetId] = useState<string | null>(null);
	// The preset the server would pick for this posting's title, unless the user chooses another.
	const suggested = styleGuide.data
		? choosePreset(
				styleGuide.data,
				selection.data?.analysis.title || application.role,
				null,
				selection.data ? [selection.data.analysis.summary, ...selection.data.analysis.domain].join(" ") : "",
			)
		: null;
	const preset = presetId ?? selection.data?.plan.style?.presetId ?? suggested?.id ?? null;
	const [now] = useState(() => new Date());
	const years = profile.data ? yearsSinceFirstRole(profile.data.entries, now) : 0;
	const presets = (styleGuide.data?.presets ?? []).map((item) => ({
		id: item.id,
		pages: pagesFor(item.rules, years),
		label: `${item.name} · ${plural(pagesFor(item.rules, years), { one: "# page", other: "# pages" })}`,
		suggested: item.id === suggested?.id,
	}));
	/** A preset with a different page target refits the selection, so what was left out for length comes back. */
	const choosePresetFor = (id: string) => {
		setPresetId(id);
		const next = presets.find((item) => item.id === id);
		if (current && next && next.pages !== current.plan.style?.pages)
			propose.mutate({ applicationId: application.id, quality, presetId: id });
	};
	const styleControl =
		presets.length > 0 ? (
			<StyleChoice
				id={`${formId}-style`}
				value={preset ?? ""}
				presets={presets}
				pending={propose.isPending}
				onChange={choosePresetFor}
			/>
		) : null;
	const [result, setResult] = useState<AssembleResult | null>(null);

	const achievements =
		(profile.data?.entries.reduce((sum, entry) => sum + entry.achievements.length, 0) ?? 0) +
		(profile.data?.standalone.length ?? 0);
	const hasPosting = Boolean(application.jobDescription?.trim() || application.requirements.length);

	const assemble = useMutation({
		...orpc.masterProfile.assemble.mutationOptions(),
		onSuccess: (data) => {
			setResult(data);
			invalidate(application.id);
		},
		onError: (error) => toastError(error, t`Couldn't assemble the resume. Try again.`),
	});

	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setResult(null);
			setStep("select");
			setGapsDone(false);
		}
	};
	const reviewing = !result && step === "select";

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				className={cn("max-h-[92svh] overflow-y-auto", reviewing && current ? "sm:max-w-3xl" : "sm:max-w-xl")}
			>
				<DialogHeader>
					<DialogTitle>
						{result
							? t`Resume assembled`
							: step === "select"
								? askingGaps && reviewing
									? t`Fill the gaps in your profile`
									: t`Choose what to include`
								: t`Build the resume`}
					</DialogTitle>
					<DialogDescription>
						{result ? (
							<Trans>Review it in the editor before you send it. Every line comes from your master profile.</Trans>
						) : step === "select" ? (
							current && askingGaps ? (
								<Trans>
									Before the resume is written: add what you've done that this posting asks for, so your profile is
									complete for this and future applications.
								</Trans>
							) : current ? (
								<Trans>
									Proposed from your whole profile for this posting. Include or leave out entries and achievements, and
									reorder bullets. Your profile itself doesn't change.
								</Trans>
							) : (
								<Trans>
									Your AI connection analyses the posting into ranked requirements, then reviews the strongest evidence
									from your whole master profile. You check the selection before anything is written. The posting and
									your profile are sent to that connection.
								</Trans>
							)
						) : (
							<Trans>
								A new resume for {application.company} is built from the selection you reviewed. With "Adjust to the
								posting", your AI connection words the bullets and writes a summary; the selected records and the
								posting are sent to it.
							</Trans>
						)}
					</DialogDescription>
				</DialogHeader>

				{result ? (
					<AssembleReport result={result} onChange={(next) => setResult({ ...result, result: next })} />
				) : step === "select" ? (
					current && askingGaps && gaps.data ? (
						<GapStep
							applicationId={application.id}
							report={gaps.data}
							entries={profile.data?.entries ?? []}
							onSkip={() => setGapsDone(true)}
							onDone={(next) => {
								saveSelection(next);
								setGapsDone(true);
								void queryClient.invalidateQueries({ queryKey: gapsOptions.queryKey });
								void queryClient.invalidateQueries({ queryKey: orpc.masterProfile.get.key() });
							}}
						/>
					) : current ? (
						<div className="grid gap-4">
							{gaps.data && (
								<div className="grid gap-1.5">
									<MatchBar report={gaps.data} />
									{gaps.data.gaps.length > 0 && (
										<button
											type="button"
											className="w-fit text-xs text-ink-3 underline underline-offset-2 hover:text-ink-2"
											onClick={() => setGapsDone(false)}
										>
											{t`${gaps.data.gaps.length} things the posting asks for are weak or missing in your profile. Review them`}
										</button>
									)}
								</div>
							)}
							{styleControl}
							<SelectionReview
								selection={current}
								saving={update.isPending}
								onChange={(edit) => update.mutate({ applicationId: application.id, ...edit })}
							/>
						</div>
					) : (
						<div className="grid gap-3">
							{profile.data && achievements === 0 && (
								<p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn-text">
									<Trans>Your master profile has no achievements yet.</Trans>{" "}
									<Link to="/dashboard/career/knowledge/profile" className="underline underline-offset-2">
										<Trans>Add some first</Trans>
									</Link>
								</p>
							)}
							{!hasPosting && (
								<p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn-text">
									<Trans>This application has no posting saved. Add the posting to the application first.</Trans>
								</p>
							)}
							{qualityControl}
							{propose.isPending && <BuildProgress phase="propose" />}
						</div>
					)
				) : (
					<div className="grid gap-4">
						{assemble.isPending && <BuildProgress phase="assemble" />}
						<div className="grid gap-1">
							<label htmlFor={`${formId}-base`} className="text-xs font-medium text-ink-2">
								<Trans>Start from (keeps its contact details, template and design)</Trans>
							</label>
							<NativeSelect
								id={`${formId}-base`}
								value={base}
								onChange={(event) => setBaseResumeId(event.target.value)}
							>
								{resumes.map((resume) => (
									<option key={resume.id} value={resume.id}>
										{resume.application ? `${resume.name} (${resume.application.company})` : resume.name}
									</option>
								))}
								<option value="">{t`A blank template, with your account's name and email`}</option>
							</NativeSelect>
							{!base && (
								<p className="text-xs text-ink-3">
									<Trans>Add your phone, location and links in the editor afterwards.</Trans>
								</p>
							)}
						</div>

						{styleControl}

						<div className="grid gap-1.5">
							<span id={`${formId}-mode`} className="text-xs font-medium text-ink-2">
								<Trans>Wording</Trans>
							</span>
							<SegmentedControl
								aria-labelledby={`${formId}-mode`}
								value={mode}
								onValueChange={(value) => setMode(value as AssembleMode)}
								className="h-[34px] w-fit"
							>
								<SegmentedControlItem value="rephrase" className="px-3">
									<Trans>Adjust to the posting</Trans>
								</SegmentedControlItem>
								<SegmentedControlItem value="verbatim" className="px-3">
									<Trans>Use my exact wording</Trans>
								</SegmentedControlItem>
							</SegmentedControl>
							<p className="text-xs text-ink-3">
								{mode === "rephrase"
									? t`Bullets may be reworded to use the posting's terms and a summary is written. Rewrites that add a number you didn't record are rejected and your wording is used instead.`
									: t`Bullets print exactly as you wrote them, or as one of your approved variants. Your existing summary is kept.`}
							</p>
						</div>
						{mode === "rephrase" && qualityControl}
						{mode === "rephrase" && (
							<SwitchRow
								checked={reviewDraft}
								onCheckedChange={setReviewDraft}
								label={t`Review the draft with AI`}
								description={t`One more request, to your model for reviewing resumes. It may reword lines; changes to what a line says wait for you.`}
							/>
						)}
					</div>
				)}

				{!(askingGaps && reviewing && current) && (
					<DialogFooter>
						{!result && step === "select" ? (
							<>
								<Button variant="ghost" onClick={() => close(false)}>
									<Trans>Cancel</Trans>
								</Button>
								{current && edited && (
									<Button
										variant="ghost"
										loading={reset.isPending}
										onClick={() => reset.mutate({ applicationId: application.id })}
									>
										<Trans>Restore the proposal</Trans>
									</Button>
								)}
								{current && (
									<Button
										variant="secondary"
										loading={propose.isPending}
										onClick={() =>
											propose.mutate({
												applicationId: application.id,
												reanalyze: current.postingChanged,
												quality,
												...(preset ? { presetId: preset } : {}),
											})
										}
									>
										{current.postingChanged ? <Trans>Analyse again</Trans> : <Trans>Propose again</Trans>}
									</Button>
								)}
								{current ? (
									<Button
										disabled={current.plan.totals.includedAchievements === 0 || update.isPending}
										onClick={() => setStep("build")}
									>
										<Trans>Next: build the resume</Trans>
										<Icon name="arrow-right" size={16} />
									</Button>
								) : (
									<Button
										loading={propose.isPending || selection.isPending}
										disabled={achievements === 0 || !hasPosting}
										onClick={() =>
											propose.mutate({
												applicationId: application.id,
												quality,
												...(preset ? { presetId: preset } : {}),
											})
										}
									>
										<Icon name="magic-wand" size={16} />
										<Trans>Analyse the posting</Trans>
									</Button>
								)}
							</>
						) : result ? (
							<>
								<Button variant="ghost" onClick={() => close(false)}>
									<Trans>Close</Trans>
								</Button>
								<Link
									to="/builder/$resumeId"
									params={{ resumeId: result.resumeId }}
									className={buttonVariants({ variant: "primary" })}
								>
									<Trans>Open the resume</Trans>
								</Link>
							</>
						) : (
							<>
								<Button variant="ghost" onClick={() => setStep("select")}>
									<Icon name="arrow-left" size={16} />
									<Trans>Back to the selection</Trans>
								</Button>
								<Button
									loading={assemble.isPending}
									disabled={achievements === 0}
									onClick={() =>
										assemble.mutate({
											applicationId: application.id,
											mode,
											quality,
											review: mode === "rephrase" && reviewDraft,
											...(base ? { baseResumeId: base } : {}),
											...(preset ? { presetId: preset } : {}),
										})
									}
								>
									<Icon name="magic-wand" size={16} />
									<Trans>Assemble resume</Trans>
								</Button>
							</>
						)}
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

type Quality = "standard" | "thorough";
type QualityChoiceProps = { id: string; value: Quality; onChange: (value: Quality) => void };

/** Standard or Thorough for this run; shown only when a Thorough model is set. */
function QualityChoice(props: QualityChoiceProps) {
	return (
		<div className="grid gap-1.5">
			<span id={props.id} className="text-xs font-medium text-ink-2">
				<Trans>Quality</Trans>
			</span>
			<SegmentedControl
				aria-labelledby={props.id}
				value={props.value}
				onValueChange={(value) => props.onChange(value as Quality)}
				className="h-[34px] w-fit"
			>
				<SegmentedControlItem value="standard" className="px-3">
					<Trans>Standard</Trans>
				</SegmentedControlItem>
				<SegmentedControlItem value="thorough" className="px-3">
					<Trans>Thorough</Trans>
				</SegmentedControlItem>
			</SegmentedControl>
			<p className="text-xs text-ink-3">
				{props.value === "thorough"
					? t`Evidence review and writing use your Thorough model. It usually costs more and takes longer.`
					: t`Uses the model set for each task.`}
			</p>
		</div>
	);
}

type StyleChoiceProps = {
	id: string;
	value: string;
	presets: Array<{ id: string; label: string; pages: number; suggested: boolean }>;
	pending: boolean;
	onChange: (presetId: string) => void;
};

/** The resume style preset, with each one's page target; one with a different length refits the selection. */
function StyleChoice({ id, value, presets, pending, onChange }: StyleChoiceProps) {
	return (
		<div className="grid gap-1">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				<Trans>Style and length</Trans>
			</label>
			<NativeSelect id={id} value={value} disabled={pending} onChange={(event) => onChange(event.target.value)}>
				{presets.map((item) => (
					<option key={item.id} value={item.id}>
						{item.suggested ? t`${item.label} (matches this posting)` : item.label}
					</option>
				))}
			</NativeSelect>
			<p className="text-xs text-ink-3">
				{pending ? (
					<Trans>Fitting the selection to the new length…</Trans>
				) : (
					<Trans>
						Length, tone, bullets and skills follow this preset. Choosing one with a different length refits the
						selection.{" "}
						<Link to="/dashboard/settings/resume-style" className="underline underline-offset-2">
							Edit your resume style
						</Link>
					</Trans>
				)}
			</p>
		</div>
	);
}

type ModelUsageProps = { usage: Writing["usage"]; quality: Writing["quality"] };

/** Which models wrote this resume and the tokens they used. */
function ModelUsage(props: ModelUsageProps) {
	const total = props.usage.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0);
	return (
		<div className="grid gap-1">
			<h4 className="text-xs font-semibold text-ink-3">
				{props.quality === "thorough" ? <Trans>Models used (Thorough)</Trans> : <Trans>Models used</Trans>}
			</h4>
			<ul className="grid gap-0.5 text-xs text-ink-3 tabular-nums">
				{props.usage.map((item, index) => (
					<li key={`${item.step}-${index}`}>
						{item.step} · {item.model} ·{" "}
						{t`${item.inputTokens.toLocaleString()} in, ${item.outputTokens.toLocaleString()} out`}
						{item.fallback ? ` · ${t`fallback`}` : ""}
					</li>
				))}
			</ul>
			{props.usage.length > 1 && (
				<p className="text-xs text-ink-3 tabular-nums">{t`${total.toLocaleString()} tokens in total`}</p>
			)}
		</div>
	);
}

type AssembleReportProps = { result: AssembleResult; onChange: (next: AssembleResult["result"]) => void };

const strengthStyle = {
	strong: { icon: "check-circle", className: "text-success-text", label: () => t`Backed` },
	partial: { icon: "circle-half", className: "text-warn-text", label: () => t`Partly backed` },
	none: { icon: "warning-circle", className: "text-danger-text", label: () => t`No evidence yet` },
} as const;

function AssembleReport({ result, onChange }: AssembleReportProps) {
	const { coverage, bullets, warnings } = result.result;
	const rephrased = bullets.filter((bullet) => bullet.source === "rephrased").length;

	const writing = result.result.writing;
	return (
		<div className="grid gap-4">
			<p className="text-xs text-ink-3 tabular-nums">
				{plural(bullets.length, { one: "# bullet placed", other: "# bullets placed" })} ·{" "}
				{plural(rephrased, { one: "# reworded", other: "# reworded" })}
				{result.result.summaryUsed ? ` · ${t`new summary`}` : ""}
				{writing?.style ? ` · ${t`${writing.style.name} style`}` : ""}
				{writing
					? ` · ${t`about ${writing.stats.estimatedPages} of ${writing.stats.targetPages} pages`} · ${plural(writing.stats.skills, { one: "# skill", other: "# skills" })}`
					: ""}
			</p>

			{writing?.review && <ReviewPanel assemblyId={result.assemblyId} review={writing.review} onChange={onChange} />}

			{writing && <QualityChecks writing={writing} />}

			{writing?.rendering && <RenderingPanel rendering={writing.rendering} />}

			{writing && writing.usage.length > 0 && <ModelUsage usage={writing.usage} quality={writing.quality} />}

			{coverage.length > 0 && (
				<div className="grid gap-1.5">
					<h4 className="text-xs font-semibold text-ink-3">
						<Trans>What the posting asks for</Trans>
					</h4>
					<ul className="grid gap-1">
						{coverage.map((item) => {
							const style = strengthStyle[item.strength];
							return (
								<li key={item.requirement} className="flex items-start gap-2 text-[13px]">
									<Icon
										name={style.icon}
										size={16}
										className={cn("mt-0.5 flex-none", style.className)}
										aria-label={style.label()}
									/>
									<span className="flex-1">{item.requirement}</span>
									<span className={cn("text-xs whitespace-nowrap", style.className)}>{style.label()}</span>
								</li>
							);
						})}
					</ul>
					{coverage.some((item) => item.strength === "none") && (
						<p className="text-xs text-ink-3">
							<Trans>
								Missing evidence isn't missing ability. If you have done it, add it to your profile and assemble again.
							</Trans>
						</p>
					)}
				</div>
			)}

			{warnings.length > 0 && (
				<div className="grid gap-1 rounded-lg bg-sunken px-3 py-2">
					<h4 className="text-xs font-semibold text-ink-2">
						<Trans>Kept as you wrote it</Trans>
					</h4>
					<ul className="grid gap-0.5 text-xs text-ink-2">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

type Writing = NonNullable<AssembleResult["result"]["writing"]>;
type QualityChecksProps = { writing: Writing };

const findingStyle = {
	error: { icon: "x-circle", className: "text-danger-text", label: () => t`Fix before sending` },
	warning: { icon: "warning-circle", className: "text-warn-text", label: () => t`Worth improving` },
	info: { icon: "info", className: "text-ink-3", label: () => t`Note` },
} as const;

/** The checks run on the built resume, most serious first, and how its skills were grouped. Nothing is changed by them. */
function QualityChecks({ writing }: QualityChecksProps) {
	const errors = writing.checks.filter((finding) => finding.severity === "error").length;
	return (
		<div className="grid gap-3">
			<div className="grid gap-1.5">
				<h4 className="text-xs font-semibold text-ink-3">
					<Trans>Quality checks</Trans>
				</h4>
				{writing.checks.length === 0 ? (
					<p className="flex items-center gap-2 text-[13px] text-accent-text">
						<Icon name="check-circle" size={16} />
						<Trans>Everything is backed by your profile, and nothing needs attention.</Trans>
					</p>
				) : (
					<ul className="grid gap-1">
						{writing.checks.map((finding, index) => {
							const style = findingStyle[finding.severity];
							return (
								<li key={`${finding.code}-${index}`} className="flex items-start gap-2 text-[13px]">
									<Icon
										name={style.icon}
										size={16}
										className={cn("mt-0.5 flex-none", style.className)}
										aria-label={style.label()}
									/>
									<span className="flex-1">{finding.message}</span>
								</li>
							);
						})}
					</ul>
				)}
				{errors > 0 && (
					<p className="text-xs text-danger-text">
						<Trans>
							Something on this resume isn't backed by your profile. Fix it in the editor before you send it.
						</Trans>
					</p>
				)}
			</div>
			{writing.skillGroups.length > 0 && (
				<div className="grid gap-1">
					<h4 className="text-xs font-semibold text-ink-3">
						<Trans>Skills, grouped</Trans>
					</h4>
					<p className="text-[13px] text-ink-2">{writing.skillGroups.map((group) => group.name).join(" · ")}</p>
					{writing.skillsLeftOut.length > 0 && (
						<p className="text-xs text-ink-3">
							{t`Left out: ${writing.skillsLeftOut
								.slice(0, 6)
								.map((item) => `${item.name} (${item.reason.toLowerCase()})`)
								.join("; ")}`}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
