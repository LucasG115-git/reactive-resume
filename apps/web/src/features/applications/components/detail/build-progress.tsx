import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";

type Phase = "propose" | "assemble";

/** The known macro-steps of each long request. The server doesn't stream progress, so these are labels, not milestones. */
const STEPS: Record<Phase, () => string[]> = {
	propose: () => [t`Analysing the posting`, t`Ranking your experience`, t`Reviewing the best evidence`],
	assemble: () => [t`Selecting the evidence`, t`Writing the bullets`, t`Reviewing the draft`, t`Final checks`],
};

// Roughly how long a step tends to run before we advance the indicator. The last step holds until the call resolves.
const STEP_MS = 6000;

/**
 * A phase-based waiting indicator for the propose and assemble calls. The current step advances on a timer and the
 * bar fills toward (but never reaches) the end, so a slow request reads as steady progress rather than a dead spinner.
 */
export function BuildProgress({ phase }: { phase: Phase }) {
	const steps = STEPS[phase]();
	// Mounts fresh for each phase (propose and assemble render in different places), so it starts at the first step.
	const [current, setCurrent] = useState(0);
	useEffect(() => {
		const id = window.setInterval(() => {
			setCurrent((value) => Math.min(value + 1, steps.length - 1));
		}, STEP_MS);
		return () => window.clearInterval(id);
	}, [steps.length]);

	// An estimate that parks near the end until the server responds, so it never claims to be finished early.
	const fill = ((current + 1) / (steps.length + 1)) * 100;

	return (
		<div className="grid gap-3" role="status" aria-live="polite">
			<ol className="grid gap-2.5">
				{steps.map((label, index) => {
					const done = current > index;
					const active = current === index;
					return (
						<li
							key={label}
							className={cn("flex items-center gap-2.5 text-sm", done || active ? "text-ink" : "text-ink-3")}
						>
							{done ? (
								<Icon name="check-circle" size={18} className="text-success-text" />
							) : active ? (
								<Spinner decorative className="size-[18px]" />
							) : (
								<span className="size-[18px] rounded-full border-[1.5px] border-line-2" />
							)}
							<span className="font-medium">{label}</span>
						</li>
					);
				})}
			</ol>
			<div
				className="h-1 overflow-hidden rounded-sm bg-sunken"
				role="progressbar"
				aria-label={t`Build progress`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(fill)}
			>
				<div
					className="h-full rounded-sm bg-accent transition-[width] duration-standard ease-enter"
					style={{ width: `${fill}%` }}
				/>
			</div>
			<p className="text-xs text-ink-3">
				<Trans>This can take a minute — you can keep this open.</Trans>
			</p>
		</div>
	);
}
