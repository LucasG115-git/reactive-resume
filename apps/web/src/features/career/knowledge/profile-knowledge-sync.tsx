import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { toast } from "@reactive-resume/ui/components/toast";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type SyncResult = RouterOutput["masterProfile"]["syncKnowledge"];

/** Lines describing a sync, leaving out anything that's zero. */
export function describeSync(result: SyncResult): string[] {
	return [
		result.added ? t`${result.added} new facts` : "",
		result.updated ? t`${result.updated} facts updated from profile edits (old text kept in each fact's history)` : "",
		result.switchedOff
			? t`${result.switchedOff} facts switched off because their profile item is hidden or deleted`
			: "",
		result.keptCorrections ? t`${result.keptCorrections} facts you corrected in Knowledge, left as you wrote them` : "",
		result.keptOff ? t`${result.keptOff} facts you switched off or forgot, left that way` : "",
	].filter(Boolean);
}

/** "Sync to Knowledge": profile → Career Knowledge facts, previewed first. */
export function ProfileKnowledgeSync() {
	const queryClient = useQueryClient();
	const [preview, setPreview] = useState<SyncResult | null>(null);

	const check = useMutation({
		...orpc.masterProfile.syncKnowledge.mutationOptions(),
		onSuccess: setPreview,
		onError: (error) => toastError(error, t`Couldn't check your Knowledge. Try again.`),
	});
	const run = useMutation({
		...orpc.masterProfile.syncKnowledge.mutationOptions(),
		onSuccess: (result) => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
			setPreview(null);
			toast.add({
				type: "success",
				description: t`Knowledge synced: ${result.added} added, ${result.updated} updated, ${result.switchedOff} switched off.`,
			});
		},
		onError: (error) => toastError(error, t`Couldn't sync your Knowledge. Try again.`),
	});

	const changes = preview ? preview.added + preview.updated + preview.switchedOff : 0;
	const lines = preview ? describeSync(preview) : [];

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-2 py-1.5 ps-3.5 pe-1.5">
				<Icon name="arrows-clockwise" size={20} className="text-ink-3" />
				<span className="min-w-0 flex-1 basis-48 text-[13px] text-ink-2">
					<Trans>Use this profile in Fit, Apply, Prepare and the coach by syncing it to your Facts</Trans>
				</span>
				<Button
					variant="secondary"
					size="sm"
					className="h-8"
					loading={check.isPending}
					onClick={() => check.mutate({ dryRun: true })}
				>
					<Trans>Sync to Knowledge</Trans>
				</Button>
			</div>

			<Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t`Sync to Knowledge`}</DialogTitle>
						<DialogDescription>
							<Trans>
								Each visible entry, achievement and skill group becomes a fact marked "From your profile". Edit them
								here in your profile; sync again after changes.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					{preview &&
						(changes === 0 && lines.length === 0 ? (
							<p className="text-[13px] text-ink-2">
								<Trans>Your Facts already match your profile.</Trans>
							</p>
						) : (
							<ul className="grid list-disc gap-1 ps-5 text-[13px] text-ink-2">
								{lines.map((line) => (
									<li key={line}>{line}</li>
								))}
								{changes === 0 && (
									<li>
										<Trans>Nothing else to change.</Trans>
									</li>
								)}
							</ul>
						))}
					<p className="text-xs text-ink-3">
						<Trans>
							Facts are shared with your AI connection when you use coaching tools. You can still correct, switch off or
							forget any of them in{" "}
							<Link to="/dashboard/career/knowledge/facts" className="underline underline-offset-2">
								Facts
							</Link>
							, and syncing won't undo that.
						</Trans>
					</p>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setPreview(null)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button loading={run.isPending} disabled={changes === 0} onClick={() => run.mutate({ dryRun: false })}>
							<Trans>Sync</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
