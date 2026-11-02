import type { CareerProfileData } from "@reactive-resume/schema/career";
import type {
	LocationRule,
	OrganizationPreference,
	PreferencePriority,
	SalaryPreference,
	StructuredPreferences,
	WorkArrangement,
} from "@reactive-resume/schema/career-preferences";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import {
	EMPTY_STRUCTURED_PREFERENCES,
	locationRuleSchema,
	ORGANIZATION_PREFERENCE_KINDS,
	organizationPreferenceSchema,
	SALARY_EXCEPTIONS,
	salaryPreferenceSchema,
} from "@reactive-resume/schema/career-preferences";
import { Button } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@reactive-resume/ui/components/collapsible";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { countryName, SEARCH_REGION_CODES } from "@reactive-resume/utils/region";
import { generateId } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { parseAmount } from "./amount";
import { ChipField, fieldShell } from "./fields";

/**
 * What can be saved now: a rule or preference still being filled in (a place-based rule with no places yet,
 * say) keeps its last saved version, or stays out until it's complete, so one half-typed rule never blocks
 * the rest of the profile from saving.
 */
export function savableStructured(
	draft: StructuredPreferences | undefined,
	previous: StructuredPreferences | undefined,
): StructuredPreferences | undefined {
	if (!draft) return draft;
	const keep = <T extends { id: string }>(items: T[], valid: (item: T) => boolean, before: T[] = []) =>
		items.flatMap((item) => (valid(item) ? [item] : before.filter((old) => old.id === item.id)));
	return {
		...draft,
		locationRules: keep(
			draft.locationRules,
			(rule) => locationRuleSchema.safeParse(rule).success,
			previous?.locationRules,
		),
		organization: keep(
			draft.organization,
			(item) => organizationPreferenceSchema.safeParse(item).success,
			previous?.organization,
		),
		salary:
			draft.salary === null || salaryPreferenceSchema.safeParse(draft.salary).success
				? draft.salary
				: (previous?.salary ?? null),
	};
}

const priorities = (): Record<PreferencePriority, string> => ({
	must: t`Must have`,
	strong: t`Strong preference`,
	nice: t`Nice to have`,
});

const arrangementLabels = (): Record<WorkArrangement, string> => ({
	onsite: t`On-site`,
	hybrid: t`Hybrid`,
	remote: t`Remote`,
});

type PriorityFieldProps = { value: PreferencePriority; onChange: (value: PreferencePriority) => void; label: string };

function PriorityField({ value, onChange, label }: PriorityFieldProps) {
	return (
		<SegmentedControl
			aria-label={label}
			value={value}
			onValueChange={(next) => onChange(next as PreferencePriority)}
			className="flex w-full sm:w-auto"
		>
			{Object.entries(priorities()).map(([key, text]) => (
				<SegmentedControlItem key={key} value={key} className="touch-target relative px-2 text-[13px]">
					{text}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}

type NumberFieldProps = {
	label: string;
	value: number | null;
	onChange: (value: number | null) => void;
	min: number;
	max: number;
	suffix?: string;
};

/** A whole number or nothing; out-of-range typing is clamped. */
function NumberField({ label, value, onChange, min, max, suffix }: NumberFieldProps) {
	const id = useId();
	return (
		<div className="grid content-start gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<span className={fieldShell}>
				<input
					id={id}
					type="number"
					inputMode="numeric"
					min={min}
					max={max}
					value={value ?? ""}
					onChange={(event) => {
						const number = event.target.valueAsNumber;
						onChange(Number.isNaN(number) ? null : Math.min(max, Math.max(min, Math.round(number))));
					}}
					className="w-full min-w-0 [appearance:textfield] bg-transparent text-sm outline-none [&::-webkit-inner-spin-button]:appearance-none"
				/>
				{suffix && <span className="text-[13px] whitespace-nowrap text-ink-3">{suffix}</span>}
			</span>
		</div>
	);
}

type AmountFieldProps = {
	label: string;
	value: number | null;
	onChange: (value: number | null) => void;
	hint?: string;
};

/** An amount typed in the user's own notation; separators appear once it's left. */
function AmountField({ label, value, onChange, hint }: AmountFieldProps) {
	const { i18n } = useLingui();
	const id = useId();
	const number = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 2 });
	const formatted = value === null ? "" : number.format(value);
	const [typing, setTyping] = useState<string | null>(null);
	const [invalid, setInvalid] = useState(false);
	return (
		<div className="grid content-start gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<span className={fieldShell}>
				<input
					id={id}
					inputMode="decimal"
					value={typing ?? formatted}
					aria-invalid={invalid || undefined}
					aria-describedby={invalid || hint ? `${id}-note` : undefined}
					onFocus={() => setTyping(typing ?? formatted)}
					onChange={(event) => {
						setTyping(event.target.value);
						setInvalid(false);
					}}
					onBlur={() => {
						const amount = parseAmount(typing ?? formatted, i18n.locale);
						if (amount === undefined) return setInvalid(true);
						onChange(amount);
						setTyping(null);
					}}
					className="w-full min-w-0 bg-transparent text-sm outline-none"
				/>
			</span>
			{(invalid || hint) && (
				<p
					id={`${id}-note`}
					role={invalid ? "alert" : undefined}
					className={cn("text-xs", invalid ? "text-danger-text" : "text-ink-3")}
				>
					{invalid ? t`Enter a full amount, such as 95000.` : hint}
				</p>
			)}
		</div>
	);
}

type SectionProps = { title: string; summary: string; children: ReactNode; defaultOpen?: boolean };

/** One collapsible group: closed, it says what's set in a line. */
function Section({ title, summary, children, defaultOpen = false }: SectionProps) {
	return (
		<Collapsible defaultOpen={defaultOpen} className="rounded-xl border border-line bg-surface">
			<CollapsibleTrigger className="group/section flex w-full items-center gap-3 rounded-xl px-4 py-3 text-start hover:bg-hover">
				<span className="grid flex-1 gap-0.5">
					<span className="text-sm font-semibold">{title}</span>
					<span className="text-xs text-ink-3">{summary}</span>
				</span>
				<Icon
					name="caret-down"
					size={16}
					className="text-ink-3 transition-transform duration-quick group-data-panel-open/section:rotate-180"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="grid gap-4 border-t border-line px-4 pt-3 pb-4">{children}</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

type StructuredPreferencesEditorProps = {
	profile: CareerProfileData;
	onChange: (patch: Partial<CareerProfileData>) => void;
};

/** Location rules, pay tiers and organization preferences, each with a priority. Everything is optional. */
export function StructuredPreferencesEditor({ profile, onChange }: StructuredPreferencesEditorProps) {
	const value = profile.structured ?? EMPTY_STRUCTURED_PREFERENCES;
	const update = (patch: Partial<StructuredPreferences>) => onChange({ structured: { ...value, ...patch } });

	return (
		<div className="grid gap-3">
			<div className="grid gap-1">
				<h3 className="text-sm font-semibold">
					<Trans>How roles are checked</Trans>
				</h3>
				<p className="text-xs text-ink-3">
					<Trans>
						A must-have rules a role out only when the posting confirms it isn't met; if the posting doesn't say, the
						role is marked to check. Strong preferences and nice-to-haves only change the order. You can still save and
						track any role.
					</Trans>
				</p>
			</div>
			<LocationRulesSection profile={profile} rules={value.locationRules} onChange={update} />
			<SalarySection
				profile={profile}
				salary={value.salary}
				// One change: the original minimum base follows the pay you'd accept, so offers and the mobile app agree.
				onChange={(salary) => {
					const minimum = salary.floor ?? salary.preferred;
					onChange({
						structured: { ...value, salary },
						...(minimum === null
							? {}
							: { minBase: { amount: minimum, currency: salary.currency, period: salary.period } }),
					});
				}}
			/>
			<OrganizationSection items={value.organization} onChange={(organization) => update({ organization })} />
		</div>
	);
}

type LocationRulesSectionProps = {
	profile: CareerProfileData;
	rules: LocationRule[];
	onChange: (patch: Partial<StructuredPreferences>) => void;
};

const newRule = (patch: Partial<LocationRule> = {}): LocationRule => ({
	id: generateId(),
	label: "",
	scope: "places",
	places: [],
	country: null,
	radiusKm: null,
	arrangements: ["onsite", "hybrid", "remote"],
	preferredArrangement: null,
	preferredOfficeDays: null,
	maxOfficeDays: null,
	maxCommuteMinutes: null,
	relocation: false,
	priority: "strong",
	salaryFloor: null,
	salaryPreferred: null,
	...patch,
});

function LocationRulesSection({ profile, rules, onChange }: LocationRulesSectionProps) {
	const set = (locationRules: LocationRule[]) => onChange({ locationRules });
	const legacy = profile.maxOfficeDays !== null || profile.locations.length > 0;
	const summary =
		rules.length > 0
			? rules
					.map((rule) => rule.label || t`Untitled area`)
					.join(", ")
					.slice(0, 160)
			: legacy
				? t`Using your office-day limit and places, as strong preferences.`
				: t`No location rules yet.`;

	// The original settings become one editable rule. They stay as they are for offers and the mobile app.
	const convert = () =>
		set([
			newRule({
				label: profile.locations.length > 0 ? profile.locations.join(", ").slice(0, 100) : t`Anywhere`,
				scope: profile.locations.length > 0 ? "places" : "anywhere",
				places: profile.locations.slice(0, 40),
				arrangements: profile.maxOfficeDays === 0 ? ["remote"] : ["onsite", "hybrid", "remote"],
				maxOfficeDays: profile.maxOfficeDays,
				priority: "strong",
			}),
		]);

	return (
		<Section title={t`Where and how you'll work`} summary={summary}>
			<p className="text-xs text-ink-3">
				<Trans>
					Each rule covers an area. A rule naming places is used before a country rule, and a country rule before an
					"anywhere" rule; among rules of the same kind, the higher one wins. Radius and commute time are shared with
					the coach but can't be checked against a posting.
				</Trans>
			</p>
			{rules.length === 0 && legacy && (
				<div className="flex flex-wrap items-center gap-3 rounded-lg bg-sunken px-3 py-2.5 text-xs text-ink-2">
					<span className="flex-1">
						<Trans>
							Roles are checked against your office-day limit and places as strong preferences, never as must-haves.
						</Trans>
					</span>
					<Button size="sm" variant="secondary" onClick={convert}>
						<Trans>Turn into a rule</Trans>
					</Button>
				</div>
			)}
			{rules.map((rule, index) => (
				<LocationRuleCard
					key={rule.id}
					rule={rule}
					first={index === 0}
					last={index === rules.length - 1}
					onChange={(next) => set(rules.map((item) => (item.id === rule.id ? next : item)))}
					onRemove={() => set(rules.filter((item) => item.id !== rule.id))}
					onMove={(offset) => {
						const next = [...rules];
						const [moved] = next.splice(index, 1);
						if (moved) next.splice(index + offset, 0, moved);
						set(next);
					}}
					currency={profile.structured?.salary?.currency ?? profile.minBase.currency}
				/>
			))}
			{rules.length < 20 && (
				<Button variant="secondary" size="sm" className="justify-self-start" onClick={() => set([...rules, newRule()])}>
					<Icon name="plus" size={16} />
					<Trans>Add an area</Trans>
				</Button>
			)}
		</Section>
	);
}

type LocationRuleCardProps = {
	rule: LocationRule;
	first: boolean;
	last: boolean;
	currency: string;
	onChange: (rule: LocationRule) => void;
	onRemove: () => void;
	onMove: (offset: number) => void;
};

function LocationRuleCard({ rule, first, last, currency, onChange, onRemove, onMove }: LocationRuleCardProps) {
	const { i18n } = useLingui();
	const id = useId();
	const set = (patch: Partial<LocationRule>) => onChange({ ...rule, ...patch });
	const labels = arrangementLabels();
	const toggle = (arrangement: WorkArrangement) => {
		const arrangements = rule.arrangements.includes(arrangement)
			? rule.arrangements.filter((item) => item !== arrangement)
			: [...rule.arrangements, arrangement];
		if (arrangements.length === 0) return;
		set({
			arrangements,
			preferredArrangement:
				rule.preferredArrangement && arrangements.includes(rule.preferredArrangement)
					? rule.preferredArrangement
					: null,
		});
	};
	const officeDays = rule.arrangements.includes("hybrid");
	const problems = locationRuleSchema.safeParse(rule).error?.issues.map((issue) => issue.message) ?? [];
	const name = rule.label || t`this area`;

	return (
		<fieldset className="grid gap-3.5 rounded-lg border border-line-2 p-3.5">
			<legend className="sr-only">{rule.label || t`New area`}</legend>
			<div className="flex flex-wrap items-end gap-3">
				<div className="grid min-w-48 flex-1 gap-1.5">
					<label htmlFor={`${id}-label`} className="text-xs font-medium text-ink-2">
						<Trans>Area name</Trans>
					</label>
					<Input
						id={`${id}-label`}
						value={rule.label}
						maxLength={100}
						placeholder={t`Greater Toronto Area`}
						onChange={(event) => set({ label: event.target.value })}
					/>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={`${id}-scope`} className="text-xs font-medium text-ink-2">
						<Trans>Covers</Trans>
					</label>
					<NativeSelect
						id={`${id}-scope`}
						value={rule.scope}
						onChange={(event) => set({ scope: event.target.value as LocationRule["scope"] })}
					>
						<option value="places">{t`Named places`}</option>
						<option value="country">{t`A country`}</option>
						<option value="anywhere">{t`Anywhere else`}</option>
					</NativeSelect>
				</div>
				<div className="flex gap-1">
					<IconButton icon="arrow-up" label={t`Move up`} size="icon-sm" disabled={first} onClick={() => onMove(-1)} />
					<IconButton icon="arrow-down" label={t`Move down`} size="icon-sm" disabled={last} onClick={() => onMove(1)} />
					<IconButton icon="trash" label={t`Remove ${name}`} size="icon-sm" onClick={onRemove} />
				</div>
			</div>

			{rule.scope === "places" && (
				<ChipField
					label={t`Places that identify it in a posting`}
					placeholder={t`Add a city or region, then Enter`}
					value={rule.places}
					onChange={(places) => set({ places })}
				/>
			)}
			{rule.scope === "country" && (
				<div className="grid gap-1.5 sm:max-w-72">
					<label htmlFor={`${id}-country`} className="text-xs font-medium text-ink-2">
						<Trans>Country</Trans>
					</label>
					<NativeSelect
						id={`${id}-country`}
						value={rule.country ?? ""}
						onChange={(event) => set({ country: event.target.value || null })}
					>
						<option value="">{t`Choose a country`}</option>
						{SEARCH_REGION_CODES.map((code) => (
							<option key={code} value={code}>
								{countryName(code, i18n.locale)}
							</option>
						))}
					</NativeSelect>
				</div>
			)}

			<div className="grid gap-1.5">
				<span id={`${id}-arrangements`} className="text-xs font-medium text-ink-2">
					<Trans>Ways you'd work here</Trans>
				</span>
				<div role="group" aria-labelledby={`${id}-arrangements`} className="flex flex-wrap gap-1.5">
					{(Object.keys(labels) as WorkArrangement[]).map((arrangement) => (
						<button
							key={arrangement}
							type="button"
							aria-pressed={rule.arrangements.includes(arrangement)}
							onClick={() => toggle(arrangement)}
							className="touch-target relative flex h-8 items-center gap-1 rounded-md border border-line-2 px-2.5 text-[13px] font-medium text-ink-2 transition-colors duration-quick hover:bg-hover aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink"
						>
							{rule.arrangements.includes(arrangement) && <Icon name="check" size={14} />}
							{labels[arrangement]}
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div className="grid content-start gap-1.5">
					<label htmlFor={`${id}-preferred`} className="text-xs font-medium text-ink-2">
						<Trans>Preferred</Trans>
					</label>
					<NativeSelect
						id={`${id}-preferred`}
						value={rule.preferredArrangement ?? ""}
						onChange={(event) => set({ preferredArrangement: (event.target.value || null) as WorkArrangement | null })}
					>
						<option value="">{t`No preference`}</option>
						{rule.arrangements.map((arrangement) => (
							<option key={arrangement} value={arrangement}>
								{labels[arrangement]}
							</option>
						))}
					</NativeSelect>
				</div>
				{officeDays && (
					<NumberField
						label={t`Office days, at most`}
						value={rule.maxOfficeDays}
						min={0}
						max={5}
						suffix={t`a week`}
						onChange={(maxOfficeDays) => set({ maxOfficeDays })}
					/>
				)}
				{officeDays && (
					<NumberField
						label={t`Office days, ideally`}
						value={rule.preferredOfficeDays}
						min={0}
						max={5}
						suffix={t`a week`}
						onChange={(preferredOfficeDays) => set({ preferredOfficeDays })}
					/>
				)}
				<NumberField
					label={t`Commute, at most`}
					value={rule.maxCommuteMinutes}
					min={0}
					max={300}
					suffix={t`min`}
					onChange={(maxCommuteMinutes) => set({ maxCommuteMinutes })}
				/>
				{rule.scope === "places" && (
					<NumberField
						label={t`Radius`}
						value={rule.radiusKm}
						min={1}
						max={1000}
						suffix="km"
						onChange={(radiusKm) => set({ radiusKm })}
					/>
				)}
			</div>

			<SwitchRow
				label={t`Open to relocating here`}
				description={t`Off: roles that require relocating to ${name} don't meet this rule.`}
				checked={rule.relocation}
				onCheckedChange={(relocation) => set({ relocation })}
			/>

			<div className="grid gap-3 sm:grid-cols-2">
				<AmountField
					label={t`Absolute minimum pay here (${currency})`}
					value={rule.salaryFloor}
					hint={t`Optional; replaces the general minimum in this area.`}
					onChange={(salaryFloor) => set({ salaryFloor })}
				/>
				<AmountField
					label={t`Preferred minimum here (${currency})`}
					value={rule.salaryPreferred}
					onChange={(salaryPreferred) => set({ salaryPreferred })}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs font-medium text-ink-2">
					<Trans>How much this rule matters</Trans>
				</span>
				<PriorityField
					label={t`How much ${name} matters`}
					value={rule.priority}
					onChange={(priority) => set({ priority })}
				/>
			</div>
			{problems.length > 0 && (
				<p role="status" className="text-xs text-warn-text">
					{problems.join(" ")} <Trans>This rule isn't saved until then.</Trans>
				</p>
			)}
		</fieldset>
	);
}

type SalarySectionProps = {
	profile: CareerProfileData;
	salary: SalaryPreference | null;
	onChange: (salary: SalaryPreference) => void;
};

const currencies = Intl.supportedValuesOf("currency");

function SalarySection({ profile, salary, onChange }: SalarySectionProps) {
	const { i18n } = useLingui();
	const id = useId();
	const exceptionLabels: Record<(typeof SALARY_EXCEPTIONS)[number], string> = {
		benefits: t`Strong benefits`,
		flexibility: t`Flexibility`,
		mission: t`Mission`,
		development: t`Growth and learning`,
		other: t`Something else`,
	};
	const money = (amount: number, currency: string) =>
		new Intl.NumberFormat(i18n.locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
	const current: SalaryPreference = salary ?? {
		currency: profile.minBase.currency,
		period: profile.minBase.period,
		floor: null,
		preferred: profile.minBase.amount,
		targetMin: null,
		targetMax: null,
		exceptions: [],
		exceptionNote: "",
	};
	const set = (patch: Partial<SalaryPreference>) => onChange({ ...current, ...patch });
	const summary = salary
		? [
				salary.floor !== null && t`at least ${money(salary.floor, salary.currency)}`,
				salary.preferred !== null && t`ideally ${money(salary.preferred, salary.currency)}+`,
			]
				.filter(Boolean)
				.join(", ") || t`Currency set; no amounts yet.`
		: profile.minBase.amount !== null
			? t`Using your minimum base salary as a strong preference.`
			: t`No pay preferences yet.`;
	const problems = salary
		? (salaryPreferenceSchema.safeParse(salary).error?.issues.map((issue) => issue.message) ?? [])
		: [];
	const periods = { hour: t`per hour`, month: t`per month`, year: t`per year` };

	return (
		<Section title={t`Pay`} summary={summary}>
			<p className="text-xs text-ink-3">
				<Trans>
					Pay is compared only when a posting states it in the same currency and period; otherwise it's marked unknown,
					never converted or guessed. Hourly, contract and commission pay is flagged to check.
				</Trans>
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={`${id}-currency`} className="text-xs font-medium text-ink-2">
						<Trans>Currency</Trans>
					</label>
					<NativeSelect
						id={`${id}-currency`}
						value={current.currency}
						onChange={(event) => set({ currency: event.target.value })}
					>
						{currencies.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={`${id}-period`} className="text-xs font-medium text-ink-2">
						<Trans>Pay period</Trans>
					</label>
					<NativeSelect
						id={`${id}-period`}
						value={current.period}
						onChange={(event) => set({ period: event.target.value as SalaryPreference["period"] })}
					>
						{Object.entries(periods).map(([period, label]) => (
							<option key={period} value={period}>
								{label}
							</option>
						))}
					</NativeSelect>
				</div>
				<AmountField
					label={t`Absolute minimum`}
					value={current.floor}
					hint={t`Must have: lower pay rules a role out, unless an exception below applies.`}
					onChange={(floor) => set({ floor })}
				/>
				<AmountField
					label={t`Preferred minimum`}
					value={current.preferred}
					hint={t`Strong preference.`}
					onChange={(preferred) => set({ preferred })}
				/>
				<AmountField
					label={t`Target range, from`}
					value={current.targetMin}
					hint={t`Nice to have.`}
					onChange={(targetMin) => set({ targetMin })}
				/>
				<AmountField
					label={t`Target range, to`}
					value={current.targetMax}
					onChange={(targetMax) => set({ targetMax })}
				/>
			</div>
			<div className="grid gap-1.5">
				<span id={`${id}-exceptions`} className="text-xs font-medium text-ink-2">
					<Trans>Would consider less for</Trans>
				</span>
				<div role="group" aria-labelledby={`${id}-exceptions`} className="flex flex-wrap gap-1.5">
					{SALARY_EXCEPTIONS.map((exception) => {
						const on = current.exceptions.includes(exception);
						return (
							<button
								key={exception}
								type="button"
								aria-pressed={on}
								onClick={() =>
									set({
										exceptions: on
											? current.exceptions.filter((item) => item !== exception)
											: [...current.exceptions, exception],
									})
								}
								className="touch-target relative flex h-8 items-center gap-1 rounded-md border border-line-2 px-2.5 text-[13px] font-medium text-ink-2 transition-colors duration-quick hover:bg-hover aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink"
							>
								{on && <Icon name="check" size={14} />}
								{exceptionLabels[exception]}
							</button>
						);
					})}
				</div>
				{current.exceptions.length > 0 && (
					<>
						<p className="text-xs text-ink-3">
							<Trans>
								With an exception, pay below the absolute minimum counts against a role but doesn't rule it out.
							</Trans>
						</p>
						<label htmlFor={`${id}-note`} className="sr-only">
							<Trans>What would make it worth it</Trans>
						</label>
						<Input
							id={`${id}-note`}
							value={current.exceptionNote}
							maxLength={500}
							placeholder={t`What would make it worth it? (optional)`}
							onChange={(event) => set({ exceptionNote: event.target.value })}
						/>
					</>
				)}
			</div>
			{problems.length > 0 && (
				<p role="status" className="text-xs text-warn-text">
					{problems.join(" ")} <Trans>Pay changes aren't saved until then.</Trans>
				</p>
			)}
		</Section>
	);
}

type OrganizationSectionProps = {
	items: OrganizationPreference[];
	onChange: (items: OrganizationPreference[]) => void;
};

function OrganizationSection({ items, onChange }: OrganizationSectionProps) {
	const kinds: Record<OrganizationPreference["kind"], string> = {
		industry: t`Industry`,
		organizationType: t`Type of organization`,
		mission: t`Mission`,
		size: t`Size`,
		autonomy: t`Autonomy`,
		management: t`Management`,
		development: t`Growth`,
		benefits: t`Benefits`,
		employmentType: t`Employment type`,
		other: t`Other`,
	};
	const summary =
		items.length > 0
			? items
					.map((item) => (item.stance === "avoid" ? t`not ${item.value}` : item.value) || kinds[item.kind])
					.join(", ")
					.slice(0, 160)
			: t`Industry, organization type, mission, size, benefits, employment type…`;
	const set = (id: string, patch: Partial<OrganizationPreference>) =>
		onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

	return (
		<Section title={t`The organization and the role`} summary={summary}>
			<p className="text-xs text-ink-3">
				<Trans>
					Checked by whether the posting mentions it, so use the words a posting would: "nonprofit", "permanent",
					"pension". Anything subtler is left for the coach to read.
				</Trans>
			</p>
			{items.map((item) => (
				<div
					key={item.id}
					className="grid gap-2 rounded-lg border border-line-2 p-3 sm:grid-cols-[10rem_7rem_1fr_auto]"
				>
					<NativeSelect
						aria-label={t`Kind`}
						value={item.kind}
						onChange={(event) => set(item.id, { kind: event.target.value as OrganizationPreference["kind"] })}
					>
						{ORGANIZATION_PREFERENCE_KINDS.map((kind) => (
							<option key={kind} value={kind}>
								{kinds[kind]}
							</option>
						))}
					</NativeSelect>
					<NativeSelect
						aria-label={t`Want or avoid`}
						value={item.stance}
						onChange={(event) => set(item.id, { stance: event.target.value as OrganizationPreference["stance"] })}
					>
						<option value="want">{t`Want`}</option>
						<option value="avoid">{t`Avoid`}</option>
					</NativeSelect>
					<Input
						aria-label={t`What`}
						value={item.value}
						maxLength={200}
						placeholder={t`Nonprofit`}
						onChange={(event) => set(item.id, { value: event.target.value })}
					/>
					<IconButton
						icon="trash"
						size="icon-sm"
						label={t`Remove ${item.value || kinds[item.kind]}`}
						onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}
					/>
					<div className="sm:col-span-4">
						<PriorityField
							label={t`How much ${item.value || kinds[item.kind]} matters`}
							value={item.priority}
							onChange={(priority) => set(item.id, { priority })}
						/>
					</div>
				</div>
			))}
			{items.length < 40 && (
				<Button
					variant="secondary"
					size="sm"
					className="justify-self-start"
					onClick={() =>
						onChange([...items, { id: generateId(), kind: "industry", value: "", stance: "want", priority: "nice" }])
					}
				>
					<Icon name="plus" size={16} />
					<Trans>Add a preference</Trans>
				</Button>
			)}
		</Section>
	);
}
