import type { RouterOutput } from "@/libs/orpc/client";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Result = RouterOutput["masterProfile"]["assemble"]["result"];
type Writing = NonNullable<Result["writing"]>;
type Review = NonNullable<Writing["review"]>;
type Rendering = NonNullable<Writing["rendering"]>;

const categoryLabels = (): Record<Review["findings"][number]["category"], string> => ({
	relevance: t`Relevance`,
	strength: t`Strength`,
	prioritization: t`Priorities`,
	tone: t`Tone`,
	clarity: t`Clarity`,
	redundancy: t`Repetition`,
	accuracy: t`Accuracy`,
});

const severityStyle = {
	high: "text-danger-text",
	medium: "text-warn-text",
	low: "text-ink-3",
} as const;

type ReviewPanelProps = {
	assemblyId: string;
	review: Review;
	onChange: (result: Result) => void;
};

/** The AI reviewer's findings, and each rewrite with its draft wording, to keep, put back, apply or dismiss. */
export function ReviewPanel({ assemblyId, review, onChange }: ReviewPanelProps) {
	const queryClient = useQueryClient();
	const revision = useMutation({
		...orpc.masterProfile.revision.mutationOptions(),
		onSuccess: (result) => {
			onChange(result);
			void queryClient.invalidateQueries({ queryKey: orpc.documents.list.key() });
		},
		onError: (error) => toastError(error, t`Couldn't change that line. Try again.`),
	});
	const labels = categoryLabels();
	const general = review.findings.filter(
		(finding) => !review.revisions.some((item) => (item.achievementId ?? "summary") === finding.ref),
	);

	return (
		<div className="grid gap-2">
			<h4 className="text-xs font-semibold text-ink-3">
				{review.score === null ? <Trans>AI review</Trans> : <Trans>AI review · {review.score} out of 10</Trans>}
			</h4>
			{review.findings.length === 0 && review.revisions.length === 0 && (
				<p className="text-[13px] text-ink-2">
					<Trans>No changes suggested.</Trans>
				</p>
			)}
			{review.revisions.length > 0 && (
				<ul className="grid gap-2">
					{review.revisions.map((item, index) => {
						const pending = revision.isPending && revision.variables?.index === index;
						const act = (action: "revert" | "apply" | "dismiss") => revision.mutate({ assemblyId, index, action });
						return (
							<li
								key={`${item.achievementId ?? "summary"}-${index}`}
								className="grid gap-1.5 rounded-lg border border-line p-2.5"
							>
								<p className="text-xs text-ink-3">
									{item.status === "applied" ? (
										<Trans>Changed by the reviewer</Trans>
									) : item.status === "needs-review" ? (
										<Trans>Suggested — needs your review: {item.reason}</Trans>
									) : item.status === "reverted" ? (
										<Trans>Put back to the draft wording</Trans>
									) : (
										<Trans>Dismissed</Trans>
									)}
								</p>
								<dl className="grid gap-1 text-[13px]">
									<div className={cn("grid gap-0.5", item.status === "applied" ? "text-ink-3" : "")}>
										<dt className="text-xs text-ink-3">
											<Trans>Draft</Trans>
											{item.status !== "applied" && ` · ${t`in your resume`}`}
										</dt>
										<dd>{item.before || t`(no summary)`}</dd>
									</div>
									<div className={cn("grid gap-0.5", item.status === "applied" ? "" : "text-ink-3")}>
										<dt className="text-xs text-ink-3">
											<Trans>Reviewer</Trans>
											{item.status === "applied" && ` · ${t`in your resume`}`}
										</dt>
										<dd>{item.after}</dd>
									</div>
								</dl>
								<div className="flex flex-wrap gap-1.5">
									{item.status === "applied" && (
										<Button size="sm" variant="secondary" loading={pending} onClick={() => act("revert")}>
											<Icon name="arrow-u-up-left" size={16} />
											<Trans>Use the draft wording</Trans>
										</Button>
									)}
									{(item.status === "needs-review" || item.status === "reverted") && (
										<Button size="sm" variant="secondary" loading={pending} onClick={() => act("apply")}>
											<Icon name="check" size={16} />
											{item.status === "reverted" ? <Trans>Use the reviewer's wording</Trans> : <Trans>Apply</Trans>}
										</Button>
									)}
									{item.status === "needs-review" && (
										<Button size="sm" variant="ghost" loading={pending} onClick={() => act("dismiss")}>
											<Trans>Dismiss</Trans>
										</Button>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{general.length > 0 && (
				<ul className="grid gap-1">
					{general.map((finding, index) => (
						<li key={`${finding.category}-${index}`} className="flex items-start gap-2 text-[13px]">
							<span className={cn("w-20 flex-none text-xs font-medium", severityStyle[finding.severity])}>
								{labels[finding.category]}
							</span>
							<span className="flex-1">{finding.message}</span>
						</li>
					))}
				</ul>
			)}
			{review.revisions.some((item) => item.status === "needs-review") && (
				<p className="text-xs text-ink-3">
					<Trans>
						Suggestions that would change what a line says wait for you. Apply one only if it's true; your master
						profile isn't changed either way.
					</Trans>
				</p>
			)}
		</div>
	);
}

type RenderingPanelProps = { rendering: Rendering };

/** The exported PDF and Word file, read back the way an applicant tracking system would. */
export function RenderingPanel({ rendering }: RenderingPanelProps) {
	const percent = (value: number) => `${Math.round(value * 100)}%`;
	return (
		<div className="grid gap-1">
			<h4 className="text-xs font-semibold text-ink-3">
				<Trans>Exported files</Trans>
			</h4>
			<ul className="grid gap-0.5 text-xs text-ink-2 tabular-nums">
				{rendering.pdf && (
					<li>
						{t`PDF: ${plural(rendering.pdf.pages, { one: "# page", other: "# pages" })} · ${percent(rendering.pdf.textCoverage)} of lines read back`}
						{rendering.pdf.atsScore !== null ? ` · ${t`ATS ${rendering.pdf.atsScore}`}` : ""}
						{rendering.pdf.blankPages.length > 0 ? ` · ${t`blank page ${rendering.pdf.blankPages.join(", ")}`}` : ""}
						{rendering.pdf.readingOrder ? "" : ` · ${t`reading order differs`}`}
					</li>
				)}
				{rendering.docx && <li>{t`Word: ${percent(rendering.docx.textCoverage)} of lines read back`}</li>}
				{rendering.errors.map((error) => (
					<li key={error} className="text-warn-text">
						{error}
					</li>
				))}
			</ul>
		</div>
	);
}

type FeedbackFormProps = { assemblyId: string; onDone?: () => void };

/** A rating and note on a generated resume; the user's edits to it are learned as writing preferences. */
export function FeedbackForm({ assemblyId, onDone }: FeedbackFormProps) {
	const id = useId();
	const [rating, setRating] = useState<"good" | "needs-work" | null>(null);
	const [note, setNote] = useState("");
	const [learn, setLearn] = useState(true);
	const submit = useMutation({
		...orpc.masterProfile.feedback.submit.mutationOptions(),
		onSuccess: (feedback) => {
			const learned = feedback.corrections.length;
			toast.add({
				description: learned
					? t`Thanks. Later resumes will follow your feedback and ${learned} edited lines.`
					: t`Thanks. Later resumes will follow your feedback.`,
			});
			onDone?.();
		},
		onError: (error) => toastError(error, t`Couldn't save your feedback. Try again.`),
	});
	return (
		<div className="grid gap-2.5">
			<div className="grid gap-1.5">
				<span id={`${id}-rating`} className="text-xs font-medium text-ink-2">
					<Trans>How did this resume turn out?</Trans>
				</span>
				<SegmentedControl
					aria-labelledby={`${id}-rating`}
					value={rating ?? ""}
					onValueChange={(value) => setRating(value as "good" | "needs-work")}
					className="h-[34px] w-fit"
				>
					<SegmentedControlItem value="good" className="px-3">
						<Icon name="thumbs-up" size={16} />
						<Trans>Good</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="needs-work" className="px-3">
						<Trans>Needs work</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</div>
			<Textarea
				aria-label={t`What to do differently`}
				placeholder={t`What to keep or do differently next time, e.g. "Less formal" or "Lead with results"`}
				value={note}
				maxLength={1000}
				onChange={(event) => setNote(event.target.value)}
				className="min-h-16 text-[13px]"
			/>
			<SwitchRow
				checked={learn}
				onCheckedChange={setLearn}
				label={t`Learn from my edits`}
				description={t`Compares the resume as it is now with what was generated. Used for wording only; your profile isn't changed.`}
			/>
			<Button
				size="sm"
				className="w-fit"
				disabled={!rating && !note.trim() && !learn}
				loading={submit.isPending}
				onClick={() => submit.mutate({ assemblyId, rating, note, learnFromEdits: learn })}
			>
				<Trans>Send feedback</Trans>
			</Button>
		</div>
	);
}
