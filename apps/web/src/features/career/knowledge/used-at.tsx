import type { RouterOutput } from "@/libs/orpc/client";
import type { ProfileEntryKind } from "@reactive-resume/schema/master-profile";
import { plural, t } from "@lingui/core/macro";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";

type Entry = Pick<
	RouterOutput["masterProfile"]["get"]["entries"][number],
	"id" | "kind" | "title" | "organization" | "startDate" | "endDate"
>;

type UsedAtProps = {
	label: string;
	entries: Entry[];
	value: string[];
	onChange: (entryIds: string[]) => void;
	className?: string;
};

export const entryLabel = (entry: Pick<Entry, "title" | "organization">) =>
	entry.organization ? `${entry.title} — ${entry.organization}` : entry.title;

/** Groups in the order a resume lists them. */
const GROUPS: ProfileEntryKind[] = ["position", "volunteer", "project", "education", "certification", "award"];

const groupLabel = (kind: ProfileEntryKind) =>
	({
		position: t`Experience`,
		volunteer: t`Volunteering`,
		project: t`Projects`,
		education: t`Education`,
		certification: t`Certifications`,
		award: t`Awards`,
	})[kind];

const years = (entry: Entry) => {
	const start = entry.startDate?.slice(0, 4);
	const end = entry.endDate?.slice(0, 4);
	if (!start && !end) return "";
	if (!end) return start ? t`${start} – now` : "";
	return start && start !== end ? `${start} – ${end}` : end;
};

/** Ongoing first, then latest end: the order the profile shows them. */
const byRecency = (a: Entry, b: Entry) =>
	(b.endDate ?? "9999").localeCompare(a.endDate ?? "9999") || (b.startDate ?? "").localeCompare(a.startDate ?? "");

/**
 * The roles, volunteering, projects and courses where a skill or tool was used: any number of them. The choices are
 * grouped by kind in a popup with a search, and only what's chosen is shown inline.
 */
export function UsedAt({ label, entries, value, onChange, className }: UsedAtProps) {
	const id = useId();
	const [query, setQuery] = useState("");
	if (entries.length === 0) return null;
	const toggle = (entryId: string, on: boolean) =>
		onChange(on ? [...value, entryId] : value.filter((item) => item !== entryId));
	const chosen = entries.filter((entry) => value.includes(entry.id));
	const needle = query.trim().toLowerCase();
	const matches = (entry: Entry) => !needle || entryLabel(entry).toLowerCase().includes(needle);
	const groups = GROUPS.map((kind) => ({
		kind,
		list: entries.filter((entry) => entry.kind === kind && matches(entry)).toSorted(byRecency),
	})).filter((group) => group.list.length > 0);

	return (
		<div className={cn("grid gap-1.5", className)}>
			<span id={`${id}-label`} className="text-xs font-medium text-ink-2">
				{label}
			</span>
			<div className="flex flex-wrap items-center gap-1.5" aria-labelledby={`${id}-label`} role="group">
				{chosen.map((entry) => (
					<span
						key={entry.id}
						className="flex min-h-7 max-w-full items-center gap-1 rounded-md border border-accent bg-accent-soft ps-2 pe-0.5 text-xs text-accent-text"
					>
						<span className="truncate">{entryLabel(entry)}</span>
						<button
							type="button"
							className="grid size-6 shrink-0 place-items-center rounded-sm hover:bg-hover"
							aria-label={t`Remove ${entryLabel(entry)}`}
							onClick={() => toggle(entry.id, false)}
						>
							<Icon name="x" size={12} />
						</button>
					</span>
				))}
				<Popover onOpenChange={(open) => !open && setQuery("")}>
					<PopoverTrigger
						render={
							<Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">
								<Icon name={chosen.length > 0 ? "pencil-simple" : "plus"} size={14} />
								{chosen.length > 0 ? t`Change` : t`Choose places`}
							</Button>
						}
					/>
					<PopoverContent align="start" className="max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-2rem)] gap-2 p-0">
						<div className="grid gap-1 border-b border-line p-3 pb-2">
							<p className="text-[13px] font-medium">{label}</p>
							<p className="text-[11px] text-ink-3">
								{value.length === 0
									? t`Pick every place it applies.`
									: plural(value.length, { one: "# chosen", other: "# chosen" })}
							</p>
							{entries.length > 6 && (
								<Input
									aria-label={t`Search your profile`}
									placeholder={t`Search`}
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									className="mt-1 h-8 text-[13px]"
								/>
							)}
						</div>
						<div className="grid gap-3 overflow-y-auto px-3 pb-3">
							{groups.length === 0 && <p className="text-xs text-ink-3">{t`Nothing matches.`}</p>}
							{groups.map((group) => (
								<fieldset key={group.kind} className="grid gap-1">
									<legend className="mb-1 font-mono text-[11px] font-medium tracking-wide text-ink-3 uppercase">
										{groupLabel(group.kind)}
									</legend>
									{group.list.map((entry) => (
										<label
											key={entry.id}
											className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-hover"
										>
											<Checkbox
												className="mt-0.5"
												checked={value.includes(entry.id)}
												onCheckedChange={(checked) => toggle(entry.id, checked)}
											/>
											<span className="min-w-0 flex-1">
												<span className="block">{entry.title}</span>
												{(entry.organization || years(entry)) && (
													<span className="block text-xs text-ink-3">
														{[entry.organization, years(entry)].filter(Boolean).join(" · ")}
													</span>
												)}
											</span>
										</label>
									))}
								</fieldset>
							))}
						</div>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
