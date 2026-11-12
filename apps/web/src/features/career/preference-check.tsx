import type { PreferenceCheck, PreferenceEvaluation } from "@reactive-resume/schema/career-preferences";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@reactive-resume/ui/components/collapsible";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const verdicts = (): Record<PreferenceEvaluation["verdict"], { label: string; className: string }> => ({
	fits: { label: t`Fits your must-haves`, className: "bg-accent-soft text-accent-text" },
	check: { label: t`Check before applying`, className: "bg-warn-soft text-warn-text" },
	conflict: { label: t`Misses a must-have`, className: "bg-danger-soft text-danger-text" },
});

const priorityLabel = (priority: PreferenceCheck["priority"]) =>
	({ must: t`Must have`, strong: t`Strong preference`, nice: t`Nice to have` })[priority];

type VerdictBadgeProps = { verdict: PreferenceEvaluation["verdict"] };

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
	const { label, className } = verdicts()[verdict];
	return (
		<span className={cn("inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium", className)}>{label}</span>
	);
}

const statusIcon = {
	met: { name: "check-circle", className: "text-success-text" },
	violated: { name: "x-circle", className: "text-danger-text" },
	unknown: { name: "question", className: "text-warn-text" },
	overridden: { name: "minus", className: "text-ink-3" },
} as const;

type PreferenceChecksProps = {
	checks: PreferenceCheck[];
	/** Offered on unmet or unknown checks, and on ones already set aside. */
	onToggle?: ((check: PreferenceCheck) => void) | undefined;
	pending?: string | null | undefined;
};

/** Each preference with its priority and the reason, must-haves first. */
export function PreferenceChecks({ checks, onToggle, pending }: PreferenceChecksProps) {
	const statusText = {
		met: t`Met`,
		violated: t`Not met`,
		unknown: t`Not stated`,
		overridden: t`Set aside for this role`,
	};
	return (
		<ul className="grid gap-2.5">
			{checks.map((check) => (
				<li key={check.key} className="flex gap-2 text-sm leading-[21px]">
					<Icon
						name={statusIcon[check.status].name}
						size={18}
						aria-label={statusText[check.status]}
						className={cn("mt-px shrink-0", statusIcon[check.status].className)}
					/>
					<span className="grid flex-1 gap-0.5">
						<span>
							<strong className={cn("font-semibold", check.status === "overridden" && "text-ink-3 line-through")}>
								{check.label}
							</strong>{" "}
							<span className="text-xs text-ink-3">
								· {priorityLabel(check.priority)}
								{check.legacy && ` · ${t`from your earlier settings`}`}
							</span>
						</span>
						<span className="text-ink-2">{check.detail}</span>
					</span>
					{onToggle && check.status !== "met" && (
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0 self-start text-ink-2"
							loading={pending === check.key}
							onClick={() => onToggle(check)}
						>
							{check.status === "overridden" ? <Trans>Count it again</Trans> : <Trans>Doesn't matter here</Trans>}
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}

type RoleVerdictProps = { evaluation: PreferenceEvaluation };

/** For a discovered role: the verdict and why, with every check one click away. */
export function RoleVerdict({ evaluation }: RoleVerdictProps) {
	if (evaluation.checks.length === 0) return null;
	return (
		<Collapsible className="grid gap-1.5">
			<div className="flex flex-wrap items-center gap-2">
				<VerdictBadge verdict={evaluation.verdict} />
				<span className="flex-1 text-[13px] text-ink-2">{evaluation.summary}</span>
				<CollapsibleTrigger className="group/why flex items-center gap-1 text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline">
					<Trans>Why</Trans>
					<Icon name="caret-down" size={14} className="transition-transform group-data-panel-open/why:rotate-180" />
				</CollapsibleTrigger>
			</div>
			<CollapsibleContent>
				<div className="pt-1.5">
					<PreferenceChecks checks={evaluation.checks} />
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

type PreferencesPanelProps = { applicationId: string };

/** One application against Preferences, computed without AI, where any preference can be set aside for this role. */
export function PreferencesPanel({ applicationId }: PreferencesPanelProps) {
	const queryClient = useQueryClient();
	const options = orpc.careerPreferences.evaluateApplication.queryOptions({ input: { applicationId } });
	const query = useQuery(options);
	const toggle = useMutation({
		...orpc.careerPreferences.setOverride.mutationOptions(),
		onSuccess: (evaluation) => queryClient.setQueryData(options.queryKey, evaluation),
		onError: (error) => toastError(error, t`Couldn't update this preference. Try again.`),
	});
	const evaluation = query.data;
	if (!evaluation) return null;

	return (
		<section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="flex-1 text-sm font-semibold">
					<Trans>Against your preferences</Trans>
				</h3>
				{evaluation.checks.length > 0 && <VerdictBadge verdict={evaluation.verdict} />}
			</div>
			{evaluation.checks.length === 0 ? (
				<p className="text-sm text-ink-2">
					<Trans>
						No preferences to check yet.{" "}
						<Link to="/dashboard/career/knowledge/preferences" className="underline underline-offset-2 hover:text-ink">
							Set them in Preferences
						</Link>
					</Trans>
				</p>
			) : (
				<>
					<p className="text-sm text-ink-2">
						{evaluation.summary}
						{evaluation.rule && ` ${t`Using your rule for ${evaluation.rule.label}.`}`}
					</p>
					<PreferenceChecks
						checks={evaluation.checks}
						pending={toggle.isPending ? toggle.variables.key : null}
						onToggle={(check) =>
							toggle.mutate({ applicationId, key: check.key, overridden: check.status !== "overridden" })
						}
					/>
				</>
			)}
		</section>
	);
}
