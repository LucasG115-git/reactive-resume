import type { ProfileEntryKind } from "@reactive-resume/schema/master-profile";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { syncResumeDates } from "@reactive-resume/schema/resume/dates";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { profileSelectionToSections } from "./from-profile";
import { addEntriesToBuiltinSection } from "./model";
import { useResumeStore } from "@/features/resume/builder/draft";
import { orpc } from "@/libs/orpc/client";

const KIND_LABEL: Record<ProfileEntryKind, () => string> = {
	position: () => t`Experience`,
	project: () => t`Projects`,
	education: () => t`Education`,
	volunteer: () => t`Volunteering`,
	certification: () => t`Certifications`,
	award: () => t`Awards`,
};
const KIND_ORDER: ProfileEntryKind[] = ["position", "project", "education", "volunteer", "certification", "award"];

type InsertFromProfileProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Pick master-profile entries and skills and insert them into the resume as sections — no AI, no server write. */
export function InsertFromProfile({ open, onOpenChange }: InsertFromProfileProps) {
	const { data: profile } = useQuery({ ...orpc.masterProfile.get.queryOptions(), enabled: open });
	const [entryIds, setEntryIds] = useState<Set<string>>(new Set());
	const [skillIds, setSkillIds] = useState<Set<string>>(new Set());

	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setEntryIds(new Set());
			setSkillIds(new Set());
		}
	};
	const toggle = (setState: typeof setEntryIds, id: string, checked: boolean) =>
		setState((previous) => {
			const next = new Set(previous);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});

	const total = entryIds.size + skillIds.size;
	const isEmpty = profile && profile.entries.length === 0 && profile.skills.length === 0;

	const insert = () => {
		if (!profile || total === 0) return;
		const groups = profileSelectionToSections(profile, { entryIds, skillIds });
		useResumeStore.getState().updateResumeData(
			(draft) => {
				for (const { type, entries } of groups) addEntriesToBuiltinSection(draft, type, entries);
				syncResumeDates(draft);
			},
			{ newStep: true },
		);
		const editor = useEditorStore.getState();
		for (const { type } of groups) {
			editor.markSectionAdded(type);
			editor.setSectionOpen(type, true);
		}
		toast.add({ type: "success", description: t`Added ${total} items from your profile.` });
		close(false);
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Insert from your profile</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Pick entries and skills from your master profile to add to this resume. They're copied in; your profile
							isn't changed.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				{!profile ? (
					<p className="py-6 text-center text-sm text-ink-3">
						<Trans>Loading your profile…</Trans>
					</p>
				) : isEmpty ? (
					<p className="text-sm text-ink-2">
						<Trans>Your master profile is empty.</Trans>{" "}
						<Link to="/dashboard/career/knowledge/profile" className="underline underline-offset-2">
							<Trans>Add your experience and skills first</Trans>
						</Link>
					</p>
				) : (
					<div className="grid max-h-[55svh] gap-4 overflow-y-auto">
						{KIND_ORDER.map((kind) => {
							const items = profile.entries.filter((entry) => entry.kind === kind);
							if (items.length === 0) return null;
							return (
								<fieldset key={kind} className="grid gap-1.5">
									<legend className="mb-1 eyebrow text-ink-3">{KIND_LABEL[kind]()}</legend>
									<div className="grid gap-1">
										{items.map((entry) => (
											<label
												key={entry.id}
												className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-hover"
											>
												<Checkbox
													checked={entryIds.has(entry.id)}
													onCheckedChange={(checked) => toggle(setEntryIds, entry.id, checked)}
												/>
												<span className="grid min-w-0 flex-1">
													<span className="truncate font-medium">{entry.title}</span>
													{entry.organization && (
														<span className="truncate text-xs text-ink-3">{entry.organization}</span>
													)}
												</span>
											</label>
										))}
									</div>
								</fieldset>
							);
						})}

						{profile.skills.length > 0 && (
							<fieldset className="grid gap-1.5">
								<legend className="mb-1 eyebrow text-ink-3">
									<Trans>Skills</Trans>
								</legend>
								<div className="flex flex-wrap gap-1.5">
									{profile.skills.map((skill) => (
										<label
											key={skill.id}
											className={cn(
												"flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[13px]",
												skillIds.has(skill.id) ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
											)}
										>
											<Checkbox
												checked={skillIds.has(skill.id)}
												onCheckedChange={(checked) => toggle(setSkillIds, skill.id, checked)}
											/>
											{skill.name}
										</label>
									))}
								</div>
							</fieldset>
						)}
					</div>
				)}

				<DialogFooter>
					<Button variant="ghost" onClick={() => close(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button disabled={total === 0} onClick={insert}>
						{total > 0 ? <Trans>Insert {total}</Trans> : <Trans>Insert</Trans>}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
