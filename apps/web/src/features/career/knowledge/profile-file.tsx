import type { RouterOutput } from "@/libs/orpc/client";
import type { ProfileFile } from "@reactive-resume/schema/master-profile";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { parse as parseYaml } from "yaml";
import { profileFileSchema } from "@reactive-resume/schema/master-profile";
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
import { PROFILE_FILE_PROMPT, PROFILE_FILE_TEMPLATE } from "./profile-file-prompt";
import { orpc } from "@/libs/orpc/client";

type Preview = RouterOutput["masterProfile"]["importFile"];

/** At most this much text is read, so a mistaken upload (a video, a whole drive export) fails fast. */
const MAX_FILE_BYTES = 1_000_000;

type ParseResult = { ok: true; file: ProfileFile } | { ok: false; problems: string[] };

/** YAML or JSON text (JSON is valid YAML) to a profile file, with every structural problem located. */
export function parseProfileFile(text: string): ParseResult {
	let data: unknown;
	try {
		// Strip a Markdown code fence, since assistants usually answer with one.
		const unfenced = text.replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/, "");
		data = parseYaml(unfenced);
	} catch (error) {
		return { ok: false, problems: [error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)] };
	}
	if (data === null || typeof data !== "object" || Array.isArray(data))
		return { ok: false, problems: [t`The file should start with sections like "experience:" and "skills:".`] };

	const result = profileFileSchema.safeParse(data);
	if (result.success) return { ok: true, file: result.data };
	return {
		ok: false,
		problems: result.error.issues.slice(0, 25).map((issue) => {
			const where = issue.path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("");
			const message =
				issue.code === "unrecognized_keys"
					? t`unknown key "${issue.keys.join('", "')}". Use experience, projects, education, volunteer, certifications, awards and skills.`
					: issue.message;
			return where ? `${where.replace(/^\./, "")}: ${message}` : message;
		}),
	};
}

/** Problems from the server: the located list it sends, or its message split into lines. */
function serverProblems(error: unknown): string[] {
	const data = (error as { data?: { problems?: unknown } } | null)?.data;
	if (Array.isArray(data?.problems)) return data.problems.map(String);
	const message = error instanceof Error ? error.message : t`Something went wrong. Try again.`;
	return message.split("\n").filter((line, index) => index > 0 || !line.endsWith(":"));
}

async function copy(text: string, done: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.add({ type: "success", description: done });
	} catch {
		toast.add({ type: "error", description: t`Couldn't copy. Select the text and copy it yourself.` });
	}
}

function download(text: string, name: string) {
	const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}

type ProfileFileImportProps = { onImported: () => void };

/** "Upload a profile file" plus the AI prompt and template that produce one. */
export function ProfileFileImport({ onImported }: ProfileFileImportProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-2 py-1.5 ps-3.5 pe-1.5">
				<Icon name="upload-simple" size={20} className="text-ink-3" />
				<span className="min-w-0 flex-1 basis-48 text-[13px] text-ink-2">
					<Trans>Add many entries at once from a profile file, or have an AI assistant write one with you</Trans>
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 text-ink-2"
					onClick={() => void copy(PROFILE_FILE_PROMPT, t`Prompt copied. Paste it into Claude or ChatGPT.`)}
				>
					<Icon name="copy" size={16} />
					<Trans>Copy AI prompt</Trans>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 text-ink-2"
					onClick={() => download(PROFILE_FILE_TEMPLATE, "profile-template.yaml")}
				>
					<Icon name="download-simple" size={16} />
					<Trans>Template</Trans>
				</Button>
				<Button variant="secondary" size="sm" className="h-8" onClick={() => setOpen(true)}>
					<Trans>Upload or paste</Trans>
				</Button>
			</div>
			<ProfileFileDialog open={open} onOpenChange={setOpen} onImported={onImported} />
		</>
	);
}

type ProfileFileDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void };

function ProfileFileDialog({ open, onOpenChange, onImported }: ProfileFileDialogProps) {
	const id = useId();
	const [text, setText] = useState("");
	const [fileName, setFileName] = useState<string | null>(null);
	const [problems, setProblems] = useState<string[]>([]);
	const [checked, setChecked] = useState<{ file: ProfileFile; preview: Preview } | null>(null);

	const preview = useMutation({
		...orpc.masterProfile.importFile.mutationOptions(),
		onError: (error) => setProblems(serverProblems(error)),
	});
	const save = useMutation({
		...orpc.masterProfile.importFile.mutationOptions(),
		onSuccess: (result) => {
			onImported();
			toast.add({
				type: "success",
				description: t`Added ${result.counts.entries} entries, ${result.counts.achievements} achievements and ${result.counts.skills} skills.`,
			});
			close(false);
		},
		onError: (error) => setProblems(serverProblems(error)),
	});

	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setText("");
			setFileName(null);
			setProblems([]);
			setChecked(null);
		}
	};

	const check = (source: string) => {
		setChecked(null);
		const parsed = parseProfileFile(source);
		if (!parsed.ok) return setProblems(parsed.problems);
		setProblems([]);
		preview.mutate(
			{ file: parsed.file, dryRun: true },
			{ onSuccess: (result) => setChecked({ file: parsed.file, preview: result }) },
		);
	};

	const readFile = async (file: File | undefined) => {
		if (!file) return;
		if (file.size > MAX_FILE_BYTES) return setProblems([t`That file is too large for a profile file (over 1 MB).`]);
		const content = await file.text();
		setFileName(file.name);
		setText(content);
		check(content);
	};

	const counts = checked?.preview.counts;
	const nothingNew = counts && counts.entries + counts.achievements + counts.skills === 0;

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{checked ? t`Review before adding` : t`Add from a profile file`}</DialogTitle>
					<DialogDescription>
						{checked ? (
							<Trans>
								Nothing is saved until you choose Add to profile. Anything already in your profile is skipped.
							</Trans>
						) : (
							<Trans>
								Upload a .yaml or .json profile file, or paste one (an AI assistant's answer is fine as it is).
							</Trans>
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
							aria-label={t`Profile file text`}
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

				{checked && counts && (
					<div className="grid gap-3">
						<p className="font-mono text-xs text-ink-3">
							{plural(counts.entries, { one: "# new entry", other: "# new entries" })} ·{" "}
							{plural(counts.achievements, { one: "# achievement", other: "# achievements" })} ·{" "}
							{plural(counts.skills, { one: "# skill", other: "# skills" })}
						</p>
						{nothingNew && (
							<p className="text-[13px] text-ink-2">
								<Trans>Everything in this file is already in your profile.</Trans>
							</p>
						)}
						<ul className="grid max-h-[45svh] gap-2 overflow-y-auto">
							{checked.preview.entries
								.filter((entry) => entry.isNew || entry.achievements.length > 0)
								.map((entry, index) => (
									// oxlint-disable-next-line react/no-array-index-key -- preview rows have no ids yet
									<li key={index} className="rounded-lg border border-line px-3 py-2">
										<p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
											{[entry.title, entry.organization].filter(Boolean).join(" · ")}
											<span
												className={cn(
													"rounded-lg px-1.5 text-[11px] font-normal",
													entry.isNew ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-2",
												)}
											>
												{entry.isNew ? t`New` : t`Adds to existing`}
											</span>
										</p>
										{entry.achievements.length > 0 && (
											<ul className="mt-1 grid list-disc gap-0.5 ps-5 text-xs text-ink-2">
												{entry.achievements.map((achievement) => (
													<li key={achievement}>{achievement}</li>
												))}
											</ul>
										)}
									</li>
								))}
						</ul>
						{(checked.preview.skills.length > 0 || checked.preview.existingSkills.length > 0) && (
							<p className="text-xs text-ink-2">
								{checked.preview.skills.length > 0 && (
									<>
										<span className="font-medium">
											<Trans>New skills:</Trans>
										</span>{" "}
										{checked.preview.skills.join(", ")}
									</>
								)}
								{checked.preview.existingSkills.length > 0 && (
									<span className="block text-ink-3">
										<Trans>Already have:</Trans> {checked.preview.existingSkills.join(", ")}
									</span>
								)}
							</p>
						)}
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
								disabled={Boolean(nothingNew)}
								onClick={() => save.mutate({ file: checked.file, dryRun: false })}
							>
								<Trans>Add to profile</Trans>
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
