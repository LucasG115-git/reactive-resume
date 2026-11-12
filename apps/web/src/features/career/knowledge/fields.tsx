import type { KeyboardEvent } from "react";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";

/** An input-like box holding a prefix/suffix and a bare input; focus rings the whole box. */
export const fieldShell =
	"flex h-9 items-center gap-1.5 rounded-md border border-line-2 bg-raised px-2.5 transition-[border-color,box-shadow] duration-quick focus-within:border-accent focus-within:shadow-focus pointer-coarse:h-11";

export const bareSelect =
	"field-sizing-content cursor-pointer appearance-none bg-transparent text-ink-3 outline-none hover:text-ink focus-visible:text-ink";

type ChipFieldProps = { label: string; placeholder: string; value: string[]; onChange: (value: string[]) => void };

/** Enter or comma adds a chip, Backspace in an empty input removes the last one, × removes one. */
export function ChipField({ label, placeholder, value, onChange }: ChipFieldProps) {
	const id = useId();
	const [input, setInput] = useState("");

	const add = () => {
		const chip = input.trim().slice(0, 200);
		if (chip && !value.includes(chip) && value.length < 20) onChange([...value, chip]);
		setInput("");
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			add();
		} else if (event.key === "Backspace" && input === "" && value.length > 0) {
			onChange(value.slice(0, -1));
		}
	};

	return (
		<div className="grid content-start gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<div className="flex min-h-10 flex-wrap items-center gap-[5px] rounded-md border border-line-2 bg-raised p-[5px] transition-[border-color,box-shadow] duration-quick focus-within:border-accent focus-within:shadow-focus">
				{value.map((chip) => (
					<span
						key={chip}
						className="flex h-7 items-center gap-0.5 rounded-sm bg-sunken ps-2.5 pe-1 text-[13px] font-medium"
					>
						{chip}
						<button
							type="button"
							aria-label={t`Remove ${chip}`}
							onClick={() => onChange(value.filter((item) => item !== chip))}
							className="touch-target relative flex size-[22px] items-center justify-center rounded-md text-ink-3 transition-colors duration-quick hover:bg-hover hover:text-ink"
						>
							<Icon name="x" size={16} />
						</button>
					</span>
				))}
				<input
					id={id}
					value={input}
					placeholder={placeholder}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={onKeyDown}
					onBlur={add}
					className="h-7 min-w-40 flex-1 bg-transparent px-1.5 text-[13px] outline-none placeholder:text-ink-3"
				/>
			</div>
		</div>
	);
}
