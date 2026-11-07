import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

type Entry = Pick<RouterOutput["masterProfile"]["get"]["entries"][number], "id" | "title" | "organization">;

type UsedAtProps = {
	label: string;
	entries: Entry[];
	value: string[];
	onChange: (entryIds: string[]) => void;
	className?: string;
};

export const entryLabel = (entry: Entry) =>
	entry.organization ? `${entry.title} — ${entry.organization}` : entry.title;

/** The roles, projects, volunteering and courses where a skill or tool was used: any number of them. */
export function UsedAt({ label, entries, value, onChange, className }: UsedAtProps) {
	if (entries.length === 0) return null;
	const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
	return (
		<fieldset className={cn("grid gap-1.5", className)}>
			<legend className="mb-1.5 text-xs font-medium text-ink-2">{label}</legend>
			<div className="flex flex-wrap gap-1.5">
				{entries.map((entry) => {
					const on = value.includes(entry.id);
					return (
						<button
							key={entry.id}
							type="button"
							aria-pressed={on}
							onClick={() => toggle(entry.id)}
							className={cn(
								"flex min-h-7 max-w-full items-center gap-1 rounded-md border px-2 text-start text-xs",
								on ? "border-accent bg-accent-soft text-accent-text" : "border-line text-ink-2 hover:bg-hover",
							)}
						>
							{on && <Icon name="check" size={12} />}
							<span className="truncate">{entryLabel(entry)}</span>
						</button>
					);
				})}
			</div>
			{value.length === 0 && <p className="text-[11px] text-ink-3">{t`Optional. Pick every place it applies.`}</p>}
		</fieldset>
	);
}
