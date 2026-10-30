import type { Application } from "../../types";
import type { RouterOutput } from "@/libs/orpc/client";
import type { AssembleMode } from "@reactive-resume/schema/master-profile";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
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
import { cn } from "@reactive-resume/utils/style";
import { useInvalidateApplications } from "../../use-application-actions";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type AssembleResult = RouterOutput["masterProfile"]["assemble"];

type AssembleDialogProps = {
	application: Application;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/** Assemble a resume for this job from the master profile, then show what the posting asked for and what backed it. */
export function AssembleDialog({ application, open, onOpenChange }: AssembleDialogProps) {
	const formId = useId();
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
	const base = baseResumeId ?? resumes[0]?.id ?? "";
	const [mode, setMode] = useState<AssembleMode>("rephrase");
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
		if (!next) setResult(null);
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{result ? t`Resume assembled` : t`Assemble from your profile`}</DialogTitle>
					<DialogDescription>
						{result ? (
							<Trans>Review it in the editor before you send it. Every line comes from your master profile.</Trans>
						) : (
							<Trans>
								Your AI connection picks the achievements and skills from your master profile that best match this
								posting, and builds a new resume for {application.company} from them. Your profile, the posting and the
								base resume's text are sent to that connection.
							</Trans>
						)}
					</DialogDescription>
				</DialogHeader>

				{result ? (
					<AssembleReport result={result} />
				) : (
					<div className="grid gap-4">
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
								<Trans>
									This application has no posting text saved, so there's little to match against. Add the posting to the
									application first for a better result.
								</Trans>
							</p>
						)}

						<div className="grid gap-1">
							<label htmlFor={`${formId}-base`} className="text-xs font-medium text-ink-2">
								<Trans>Start from (keeps its contact details, template and design)</Trans>
							</label>
							{resumes.length > 0 ? (
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
								</NativeSelect>
							) : (
								<p className="text-[13px] text-ink-3">
									<Trans>Create or import a resume first. It provides your name, contact details and design.</Trans>
								</p>
							)}
						</div>

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
					</div>
				)}

				<DialogFooter>
					{result ? (
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
							<Button variant="ghost" onClick={() => close(false)}>
								<Trans>Cancel</Trans>
							</Button>
							<Button
								loading={assemble.isPending}
								disabled={!base || achievements === 0}
								onClick={() => assemble.mutate({ applicationId: application.id, baseResumeId: base, mode })}
							>
								<Icon name="magic-wand" size={16} />
								<Trans>Assemble resume</Trans>
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type AssembleReportProps = { result: AssembleResult };

const strengthStyle = {
	strong: { icon: "check-circle", className: "text-accent-text", label: () => t`Backed` },
	partial: { icon: "circle-half", className: "text-warn-text", label: () => t`Partly backed` },
	none: { icon: "warning-circle", className: "text-danger-text", label: () => t`No evidence yet` },
} as const;

function AssembleReport({ result }: AssembleReportProps) {
	const { coverage, bullets, warnings } = result.result;
	const rephrased = bullets.filter((bullet) => bullet.source === "rephrased").length;

	return (
		<div className="grid gap-4">
			<p className="font-mono text-xs text-ink-3">
				{plural(bullets.length, { one: "# bullet placed", other: "# bullets placed" })} ·{" "}
				{plural(rephrased, { one: "# reworded", other: "# reworded" })}
				{result.result.summaryUsed ? ` · ${t`new summary`}` : ""}
			</p>

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
