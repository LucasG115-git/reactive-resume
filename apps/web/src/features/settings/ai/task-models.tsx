import type { AiTask, AiTaskSettings, TaskModel } from "@reactive-resume/schema/ai-tasks";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
	AI_TASKS,
	SUGGESTED_OPENAI_MODELS,
	TASK_TOKEN_ESTIMATES,
	THOROUGH_TASKS,
} from "@reactive-resume/schema/ai-tasks";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { getOrpcErrorMessage, toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Target = AiTask | "thorough";

const taskLabels = (): Record<Target, { title: string; description: string }> => ({
	extraction: {
		title: t`Reading postings`,
		description: t`Turns postings and files into fields and ranked requirements.`,
	},
	evidence: { title: t`Choosing evidence`, description: t`Reviews which of your achievements fit a posting.` },
	writing: { title: t`Writing resumes`, description: t`Writes the tailored resume from your reviewed selection.` },
	polish: { title: t`Polishing`, description: t`Short rewrites: application answers and replies.` },
	review: { title: t`Reviewing resumes`, description: t`Checks a finished resume for relevance, strength and tone.` },
	thorough: {
		title: t`Thorough model`,
		description: t`Replaces the models for choosing evidence, writing and reviewing, only when you choose Thorough.`,
	},
});

const efforts = (): Record<TaskModel["reasoningEffort"], string> => ({
	default: t`Provider default`,
	low: t`Low effort`,
	medium: t`Medium effort`,
	high: t`High effort`,
});

const same = (a: TaskModel, b: TaskModel) =>
	a.providerId === b.providerId && a.model === b.model && a.reasoningEffort === b.reasoningEffort;

const thousands = (value: number) => `${Math.round(value / 1000)}k`;

/** Tokens one tailored resume uses in the steps a Thorough run moves to the Thorough model. */
const thoroughShare = Object.values(TASK_TOKEN_ESTIMATES)
	.filter((step) => THOROUGH_TASKS.includes(step.task))
	.reduce((sum, step) => ({ input: sum.input + step.input, output: sum.output + step.output }), {
		input: 0,
		output: 0,
	});

export function TaskModelsSection() {
	const id = useId();
	const queryClient = useQueryClient();
	const { data: saved, isLoading, error } = useQuery(orpc.aiTasks.get.queryOptions());
	const { data: providers } = useQuery(orpc.aiProviders.list.queryOptions());
	const [draft, setDraft] = useState<AiTaskSettings | null>(null);
	const settings = draft ?? saved;
	const usable = providers?.filter((provider) => provider.enabled && provider.testStatus === "success") ?? [];
	const fallback = usable[0];
	const onSaved = (value: AiTaskSettings) => {
		queryClient.setQueryData(orpc.aiTasks.get.queryKey(), value);
		setDraft(null);
	};
	const save = useMutation(
		orpc.aiTasks.save.mutationOptions({
			onSuccess: (value) => {
				onSaved(value);
				toast.add({ description: t`Model settings saved` });
			},
			onError: (failure) => toastError(failure, t`Couldn't save model settings. Try again.`),
		}),
	);
	const check = useMutation(
		orpc.aiTasks.check.mutationOptions({
			onSuccess: onSaved,
			onError: (failure) => toastError(failure, t`Couldn't run the check. Try again.`),
		}),
	);
	const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
	const labels = taskLabels();

	const setting = (target: Target) =>
		settings ? (target === "thorough" ? settings.thorough : settings.tasks[target]) : null;
	const update = (target: Target, patch: Partial<TaskModel>) => {
		if (!settings) return;
		const next = structuredClone(settings);
		if (target === "thorough") next.thorough = { ...next.thorough, ...patch };
		else next.tasks[target] = { ...next.tasks[target], ...patch };
		setDraft(next);
	};
	const providerOf = (value: TaskModel) => usable.find((provider) => provider.id === value.providerId) ?? fallback;
	const hasOpenAi = usable.some((provider) => provider.provider === "openai");
	const suggest = () => {
		if (!settings) return;
		const next = structuredClone(settings);
		const openai = usable.find((provider) => provider.provider === "openai");
		const fill = (value: TaskModel, model: string) => {
			if (value.model) return value;
			return { ...value, model, providerId: fallback?.provider === "openai" ? value.providerId : (openai?.id ?? null) };
		};
		for (const task of AI_TASKS) next.tasks[task] = fill(next.tasks[task], SUGGESTED_OPENAI_MODELS[task]);
		next.thorough = fill(next.thorough, SUGGESTED_OPENAI_MODELS.thorough);
		setDraft(next);
	};
	const thoroughReady = Boolean(settings?.thorough.model || settings?.thorough.providerId);

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 max-sm:px-4">
				<div className="grid gap-1">
					<h2 id={`${id}-title`} className="text-[17px] font-semibold">
						<Trans>Models for each task</Trans>
					</h2>
					<p className="max-w-[60ch] text-[13px] leading-5 text-ink-3">
						<Trans>
							Use a faster model for reading and a stronger one for writing. Anything left blank uses your default
							provider and its model.
						</Trans>
					</p>
				</div>
				{hasOpenAi && settings && (
					<Button size="sm" variant="secondary" onClick={suggest}>
						<Icon name="sparkle" size={16} />
						<Trans>Fill suggested OpenAI models</Trans>
					</Button>
				)}
			</header>

			{error ? (
				<p role="alert" className="m-5 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] text-danger-text">
					{getOrpcErrorMessage(error, { fallback: t`Couldn't load model settings. Reload to try again.` })}
				</p>
			) : isLoading || !settings ? (
				<p role="status" className="flex items-center gap-2 p-5 text-sm text-ink-3">
					<Spinner decorative className="size-3.5" />
					<Trans>Loading model settings…</Trans>
				</p>
			) : usable.length === 0 ? (
				<p className="p-5 text-sm text-ink-3">
					<Trans>Connect and test an AI provider above to choose models for each task.</Trans>
				</p>
			) : (
				<>
					<ul className="divide-y divide-line">
						{([...AI_TASKS, "thorough"] as const).map((target) => {
							const value = setting(target);
							if (!value) return null;
							const provider = providerOf(value);
							const changed = saved
								? !same(value, target === "thorough" ? saved.thorough : saved.tasks[target])
								: false;
							const checking = check.isPending && check.variables?.task === target;
							return (
								<li key={target} className="grid gap-3 px-5 py-4 max-sm:px-4">
									<div className="grid gap-0.5">
										<h3 className="text-sm font-medium">{labels[target].title}</h3>
										<p className="text-[13px] leading-5 text-ink-3">{labels[target].description}</p>
									</div>
									<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
										<NativeSelect
											aria-label={t`Connection for ${labels[target].title}`}
											value={value.providerId ?? ""}
											onChange={(event) => update(target, { providerId: event.target.value || null })}
											className="text-[13px]"
										>
											<option value="">{t`Default connection`}</option>
											{usable.map((item) => (
												<option key={item.id} value={item.id}>
													{item.label}
												</option>
											))}
										</NativeSelect>
										<Input
											aria-label={t`Model for ${labels[target].title}`}
											value={value.model ?? ""}
											placeholder={target === "thorough" ? t`Not set` : (provider?.model ?? "")}
											onChange={(event) => update(target, { model: event.target.value.trim() || null })}
											className="text-[13px]"
										/>
										<NativeSelect
											aria-label={t`Reasoning effort for ${labels[target].title}`}
											value={value.reasoningEffort}
											onChange={(event) =>
												update(target, { reasoningEffort: event.target.value as TaskModel["reasoningEffort"] })
											}
											className="text-[13px] sm:min-w-40"
										>
											{Object.entries(efforts()).map(([key, label]) => (
												<option key={key} value={key}>
													{label}
												</option>
											))}
										</NativeSelect>
										<Button
											size="sm"
											variant="secondary"
											className="h-9"
											disabled={changed || check.isPending || (target === "thorough" && !thoroughReady)}
											title={changed ? t`Save to check this setting` : undefined}
											onClick={() => check.mutate({ task: target })}
										>
											{checking ? <Spinner decorative className="size-3.5" /> : <Icon name="seal-check" size={16} />}
											<Trans>Check</Trans>
										</Button>
									</div>
									<CheckResult value={value} changed={changed} />
								</li>
							);
						})}
					</ul>

					<div className="grid gap-3 border-t border-line px-5 py-4 max-sm:px-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="grid gap-0.5">
								<h3 id={`${id}-quality`} className="text-sm font-medium">
									<Trans>Default quality for tailored resumes</Trans>
								</h3>
								<p className="max-w-[60ch] text-[13px] leading-5 text-ink-3">
									{thoroughReady ? (
										<Trans>
											Thorough sends about {thousands(thoroughShare.input)} input and {thousands(thoroughShare.output)}{" "}
											output tokens per resume to the Thorough model instead, billed at its rates. You can switch per
											resume.
										</Trans>
									) : (
										<Trans>Set a Thorough model to make Thorough available. Standard uses the models above.</Trans>
									)}
								</p>
							</div>
							<SegmentedControl
								aria-labelledby={`${id}-quality`}
								value={settings.quality}
								className="h-9 w-fit"
								onValueChange={(quality) =>
									setDraft({ ...structuredClone(settings), quality: quality as AiTaskSettings["quality"] })
								}
							>
								<SegmentedControlItem value="standard">
									<Trans>Standard</Trans>
								</SegmentedControlItem>
								<SegmentedControlItem value="thorough" disabled={!thoroughReady}>
									<Trans>Thorough</Trans>
								</SegmentedControlItem>
							</SegmentedControl>
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2">
							{dirty && (
								<Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
									<Trans>Discard</Trans>
								</Button>
							)}
							<Button size="sm" disabled={!dirty || save.isPending} onClick={() => draft && save.mutate(draft)}>
								{save.isPending && <Spinner decorative className="size-3.5" />}
								<Trans>Save models</Trans>
							</Button>
						</div>
					</div>
				</>
			)}
		</section>
	);
}

type CheckResultProps = { value: TaskModel; changed: boolean };

/** The last capability check for a setting, or a prompt to run one. */
function CheckResult(props: CheckResultProps) {
	const { value, changed } = props;
	const test = value.lastTest;
	if (changed) return <p className="text-xs text-ink-3">{t`Save, then check this model.`}</p>;
	if (!test) {
		if (!value.model && !value.providerId) return null;
		return <p className="text-xs text-ink-3">{t`Not checked yet. Check it before relying on it.`}</p>;
	}
	const reasoning =
		test.reasoning === "accepted"
			? t`reasoning effort accepted`
			: test.reasoning === "rejected"
				? t`reasoning effort not accepted`
				: null;
	return (
		<p
			className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", test.ok ? "text-ink-2" : "text-danger-text")}
		>
			<Icon name={test.ok ? "check-circle" : "warning-circle"} size={14} />
			<span>{test.model}</span>
			<span>·</span>
			<span>{test.json ? t`JSON works` : t`JSON failed`}</span>
			<span>·</span>
			<span>{test.tools ? t`tool calls work` : t`no tool calls`}</span>
			{reasoning && (
				<>
					<span>·</span>
					<span>{reasoning}</span>
				</>
			)}
			{test.ok && (
				<>
					<span>·</span>
					<span>{t`${Math.round(test.latencyMs / 100) / 10}s`}</span>
				</>
			)}
			{test.message && <span className="basis-full">{test.message}</span>}
		</p>
	);
}
