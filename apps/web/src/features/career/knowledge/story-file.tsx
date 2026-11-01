import type { RouterOutput } from "@/libs/orpc/client";
import type { StoryFile } from "@reactive-resume/schema/master-profile";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { storyFileSchema } from "@reactive-resume/schema/master-profile";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { copy, download, MAX_FILE_BYTES, parseYamlFile, serverProblems } from "./profile-file";
import { buildStoryPrompt, STORY_FILE_TEMPLATE } from "./story-file-prompt";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Preview = RouterOutput["masterProfile"]["importStories"];

export const parseStoryFile = (text: string) =>
	parseYamlFile<StoryFile>(text, storyFileSchema, {
		shape: t`The file should start with "stories:".`,
		unknownKey: t`Use version and stories.`,
	});

/** "Draft stories with AI" and "Upload stories" for Knowledge → Stories. */
export function StoryFileImport() {
	const [open, setOpen] = useState(false);
	const [copying, setCopying] = useState(false);

	// The prompt carries the user's current facts, so it's built when copied, not ahead of time.
	const copyPrompt = async () => {
		setCopying(true);
		try {
			const catalog = await client.masterProfile.factCatalog();
			if (catalog.length === 0) {
				toast.add({
					type: "error",
					description: t`You have no switched-on facts yet. Sync your profile to Knowledge first.`,
				});
				return;
			}
			await copy(
				buildStoryPrompt(catalog),
				t`Prompt copied with ${catalog.length} facts. Paste it into Claude or ChatGPT.`,
			);
		} catch (error) {
			toastError(error, t`Couldn't load your facts. Try again.`);
		} finally {
			setCopying(false);
		}
	};

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-2 py-1.5 ps-3.5 pe-1.5">
				<Icon name="book-open-text" size={20} className="text-ink-3" />
				<span className="min-w-0 flex-1 basis-48 text-[13px] text-ink-2">
					<Trans>Draft interview stories from your facts with an AI assistant, then upload them here</Trans>
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 text-ink-2"
					loading={copying}
					onClick={() => void copyPrompt()}
				>
					<Icon name="copy" size={16} />
					<Trans>Copy prompt with my facts</Trans>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 text-ink-2"
					onClick={() => download(STORY_FILE_TEMPLATE, "stories-template.yaml")}
				>
					<Icon name="download-simple" size={16} />
					<Trans>Template</Trans>
				</Button>
				<Button variant="secondary" size="sm" className="h-8" onClick={() => setOpen(true)}>
					<Trans>Upload or paste</Trans>
				</Button>
			</div>
			<StoryFileDialog open={open} onOpenChange={setOpen} />
		</>
	);
}

type StoryFileDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function StoryFileDialog({ open, onOpenChange }: StoryFileDialogProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const [text, setText] = useState("");
	const [fileName, setFileName] = useState<string | null>(null);
	const [problems, setProblems] = useState<string[]>([]);
	const [checked, setChecked] = useState<{ file: StoryFile; preview: Preview } | null>(null);

	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setText("");
			setFileName(null);
			setProblems([]);
			setChecked(null);
		}
	};

	const preview = useMutation({
		...orpc.masterProfile.importStories.mutationOptions(),
		onError: (error) => setProblems(serverProblems(error)),
	});
	const save = useMutation({
		...orpc.masterProfile.importStories.mutationOptions(),
		onSuccess: (result) => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			toast.add({
				type: "success",
				description: plural(result.added, { one: "Added # story.", other: "Added # stories." }),
			});
			close(false);
		},
		onError: (error) => setProblems(serverProblems(error)),
	});

	const check = (source: string) => {
		setChecked(null);
		const parsed = parseStoryFile(source);
		if (!parsed.ok) return setProblems(parsed.problems);
		setProblems([]);
		preview.mutate(
			{ file: parsed.file, dryRun: true },
			{ onSuccess: (result) => setChecked({ file: parsed.file, preview: result }) },
		);
	};

	const readFile = async (file: File | undefined) => {
		if (!file) return;
		if (file.size > MAX_FILE_BYTES) return setProblems([t`That file is too large for a story file (over 1 MB).`]);
		const content = await file.text();
		setFileName(file.name);
		setText(content);
		check(content);
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{checked ? t`Review stories before adding` : t`Add stories from a file`}</DialogTitle>
					<DialogDescription>
						{checked ? (
							<Trans>
								Each story will be linked to the facts it cites. Nothing is saved until you choose Add stories; titles
								you already have are skipped.
							</Trans>
						) : (
							<Trans>Upload a .yaml or .json story file, or paste the assistant's answer as it is.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>

				{!checked && (
					<div className="grid gap-3">
						<label
							htmlFor={`${id}-file`}
							className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-2 px-4 py-5 text-[13px] text-ink-2 transition-colors duration-quick hover:bg-hover"
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								void readFile(event.dataTransfer.files[0]);
							}}
						>
							<Icon name="file-arrow-up" size={20} />
							{fileName ?? <Trans>Choose a file, or drop it here</Trans>}
						</label>
						<input
							id={`${id}-file`}
							type="file"
							accept=".yaml,.yml,.json,.txt,application/json,text/yaml,text/plain"
							className="sr-only"
							onChange={(event) => void readFile(event.target.files?.[0])}
						/>
						<Textarea
							aria-label={t`Story file text`}
							rows={10}
							placeholder={t`…or paste YAML or JSON here`}
							value={text}
							onChange={(event) => {
								setText(event.target.value);
								setFileName(null);
								setProblems([]);
							}}
							className="px-3 py-2 font-mono text-xs leading-[18px]"
						/>
					</div>
				)}

				{problems.length > 0 && (
					<div role="alert" className="grid gap-1 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-text">
						<p className="font-semibold">
							<Trans>Fix these, then check again:</Trans>
						</p>
						<ul className="grid list-disc gap-0.5 ps-5 font-mono text-xs">
							{problems.map((problem) => (
								<li key={problem}>{problem}</li>
							))}
						</ul>
					</div>
				)}

				{checked && (
					<div className="grid gap-3">
						<p className="font-mono text-xs text-ink-3">
							{plural(checked.preview.added, { one: "# new story", other: "# new stories" })}
							{checked.preview.skipped.length > 0 &&
								` · ${plural(checked.preview.skipped.length, { one: "# already in Knowledge", other: "# already in Knowledge" })}`}
						</p>
						<ul className="grid max-h-[45svh] gap-2 overflow-y-auto">
							{checked.preview.stories.map((story) => (
								<li key={story.title} className="rounded-lg border border-line px-3 py-2">
									<p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
										{story.title}
										<span
											className={cn(
												"rounded-lg px-1.5 text-[11px] font-normal",
												story.isNew ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-2",
											)}
										>
											{story.isNew ? t`New` : t`Already in Knowledge`}
										</span>
									</p>
									{story.facts.length > 0 ? (
										<ul className="mt-1 grid list-disc gap-0.5 ps-5 text-xs text-ink-2">
											{story.facts.map((fact) => (
												<li key={fact}>{fact}</li>
											))}
										</ul>
									) : (
										<p className="mt-1 text-xs text-warn-text">
											<Trans>No supporting facts. You can link some after adding it.</Trans>
										</p>
									)}
								</li>
							))}
						</ul>
					</div>
				)}

				<DialogFooter>
					{checked ? (
						<>
							<Button variant="ghost" onClick={() => setChecked(null)}>
								<Trans>Back</Trans>
							</Button>
							<Button
								loading={save.isPending}
								disabled={checked.preview.added === 0}
								onClick={() => save.mutate({ file: checked.file, dryRun: false })}
							>
								<Trans>Add stories</Trans>
							</Button>
						</>
					) : (
						<>
							<Button variant="ghost" onClick={() => close(false)}>
								<Trans>Cancel</Trans>
							</Button>
							<Button loading={preview.isPending} disabled={!text.trim()} onClick={() => check(text)}>
								<Trans>Check file</Trans>
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
