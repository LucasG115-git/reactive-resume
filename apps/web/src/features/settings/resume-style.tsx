import type { SelectionSection } from "@reactive-resume/schema/resume-selection";
import type { ResumeStyleGuide, RoleFamily, StylePreset } from "@reactive-resume/schema/resume-style";
import type { WritingRegion } from "@reactive-resume/schema/resume-writing";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { SELECTION_SECTIONS } from "@reactive-resume/schema/resume-selection";
import {
	presetFromTemplate,
	resumeStyleGuideSchema,
	ROLE_FAMILIES,
	ROLE_FAMILY_TEMPLATES,
} from "@reactive-resume/schema/resume-style";
import { REGION_CONVENTIONS, WRITING_REGIONS } from "@reactive-resume/schema/resume-writing";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { generateId } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection } from "./section";
import { PageHeader } from "@/components/layout/page-header";
import { ChipField } from "@/features/career/knowledge/fields";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const familyLabel = (): Record<RoleFamily, string> => ({
	general: t`General`,
	communications: t`Communications`,
	"digital-marketing": t`Digital Marketing`,
	"project-management": t`Project Management`,
	"web-development": t`Web Development`,
	other: t`Other`,
});

const sectionLabel = (): Record<SelectionSection, string> => ({
	summary: t`Summary`,
	skills: t`Skills`,
	experience: t`Experience`,
	projects: t`Projects`,
	volunteer: t`Volunteer`,
	education: t`Education`,
	certifications: t`Certifications`,
	awards: t`Awards`,
});

/** Settings → Resume style: how tailored resumes are written, per career direction. Style only, never facts. */
export function ResumeStyleSettings() {
	const query = useQuery(orpc.resumeStyle.get.queryOptions());
	return (
		<>
			<PageHeader title={<Trans>Resume style</Trans>} />
			<p className="-mt-2 max-w-2xl text-sm text-ink-3">
				<Trans>
					How tailored resumes are written: length, tone, bullets, skills and section order, as presets for the
					directions you apply in. Examples you like guide the voice; they're never used as facts. Your experience stays
					in Career → Knowledge.
				</Trans>
			</p>
			{query.data ? (
				<StyleGuideForm initial={query.data} />
			) : (
				<p className="text-sm text-ink-3">{query.isError ? t`Couldn't load your style guide.` : t`Loading…`}</p>
			)}
		</>
	);
}

type StyleGuideFormProps = { initial: ResumeStyleGuide };

function StyleGuideForm({ initial }: StyleGuideFormProps) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(initial);
	const [selectedId, setSelectedId] = useState(initial.defaultPresetId);
	const [family, setFamily] = useState<RoleFamily>("communications");
	const families = familyLabel();
	const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
	const valid = resumeStyleGuideSchema.safeParse(draft);

	const save = useMutation({
		...orpc.resumeStyle.save.mutationOptions(),
		onSuccess: (guide) => {
			queryClient.setQueryData(orpc.resumeStyle.get.queryKey(), guide);
			setDraft(guide);
			toast.add({ description: t`Resume style saved` });
		},
		onError: (error) => toastError(error, t`Couldn't save your resume style. Try again.`),
	});

	const preset = draft.presets.find((item) => item.id === selectedId) ?? draft.presets[0];
	const setPreset = (next: StylePreset) =>
		setDraft({ ...draft, presets: draft.presets.map((item) => (item.id === next.id ? next : item)) });
	const addPreset = () => {
		const id = generateId();
		const created = { ...presetFromTemplate(family, id), name: ROLE_FAMILY_TEMPLATES[family].name };
		setDraft({ ...draft, presets: [...draft.presets, created] });
		setSelectedId(id);
	};
	const removePreset = (id: string) => {
		const presets = draft.presets.filter((item) => item.id !== id);
		const first = presets[0];
		if (!first) return;
		setDraft({ ...draft, presets, defaultPresetId: draft.defaultPresetId === id ? first.id : draft.defaultPresetId });
		setSelectedId(first.id);
	};

	return (
		<div className="grid gap-6">
			<SettingsSection
				title={<Trans>Presets</Trans>}
				description={
					<Trans>
						A preset is picked automatically when a posting's title matches its keywords; you can also choose one when
						building.
					</Trans>
				}
				action={
					<div className="flex items-center gap-2">
						<NativeSelect
							aria-label={t`Start from`}
							value={family}
							onChange={(event) => setFamily(event.target.value as RoleFamily)}
							className="h-8 min-w-44 text-[13px]"
						>
							{ROLE_FAMILIES.map((item) => (
								<option key={item} value={item}>
									{families[item]}
								</option>
							))}
						</NativeSelect>
						<Button size="sm" variant="secondary" disabled={draft.presets.length >= 12} onClick={addPreset}>
							<Icon name="plus" size={16} />
							<Trans>Add preset</Trans>
						</Button>
					</div>
				}
			>
				<div role="tablist" aria-label={t`Presets`} className="flex flex-wrap gap-1.5">
					{draft.presets.map((item) => (
						<button
							key={item.id}
							type="button"
							role="tab"
							aria-selected={item.id === preset?.id}
							onClick={() => setSelectedId(item.id)}
							className="flex h-8 items-center gap-1.5 rounded-md border border-line-2 px-3 text-[13px] text-ink-2 hover:bg-hover aria-selected:border-accent aria-selected:bg-accent-soft aria-selected:text-ink"
						>
							{item.name}
							{item.id === draft.defaultPresetId && <span className="text-[11px] text-ink-3">· {t`default`}</span>}
						</button>
					))}
				</div>
				{preset && (
					<PresetEditor
						key={preset.id}
						preset={preset}
						guide={draft}
						isDefault={preset.id === draft.defaultPresetId}
						onChange={setPreset}
						onMakeDefault={() => setDraft({ ...draft, defaultPresetId: preset.id })}
						onRemove={draft.presets.length > 1 ? () => removePreset(preset.id) : undefined}
					/>
				)}
			</SettingsSection>

			<ExamplesSection guide={draft} onChange={setDraft} />

			<div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-line bg-bg py-3">
				{!valid.success && <span className="text-xs text-danger-text">{valid.error.issues[0]?.message}</span>}
				{dirty && (
					<Button variant="ghost" onClick={() => setDraft(initial)}>
						<Trans>Discard changes</Trans>
					</Button>
				)}
				<Button disabled={!dirty || !valid.success} loading={save.isPending} onClick={() => save.mutate(draft)}>
					<Trans>Save</Trans>
				</Button>
			</div>
		</div>
	);
}

type NumberFieldProps = { label: string; value: number; min: number; max: number; onChange: (value: number) => void };

function NumberField({ label, value, min, max, onChange }: NumberFieldProps) {
	const id = useId();
	return (
		<div className="grid content-start gap-1">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<Input
				id={id}
				type="number"
				min={min}
				max={max}
				value={value}
				onChange={(event) => {
					const next = event.target.valueAsNumber;
					if (!Number.isNaN(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
				}}
				className="w-24"
			/>
		</div>
	);
}

type SelectFieldProps<T extends string> = {
	label: string;
	value: T;
	options: Array<[T, string]>;
	onChange: (value: T) => void;
};

function SelectField<T extends string>({ label, value, options, onChange }: SelectFieldProps<T>) {
	const id = useId();
	return (
		<div className="grid content-start gap-1">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
				{options.map(([key, text]) => (
					<option key={key} value={key}>
						{text}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}

type PresetEditorProps = {
	preset: StylePreset;
	guide: ResumeStyleGuide;
	isDefault: boolean;
	onChange: (preset: StylePreset) => void;
	onMakeDefault: () => void;
	onRemove: (() => void) | undefined;
};

function PresetEditor({ preset, guide, isDefault, onChange, onMakeDefault, onRemove }: PresetEditorProps) {
	const id = useId();
	const set = (patch: Partial<StylePreset>) => onChange({ ...preset, ...patch });
	const rules = preset.rules;
	const setRules = (patch: Partial<StylePreset["rules"]>) => set({ rules: { ...rules, ...patch } });
	const sections = sectionLabel();
	const order = preset.sectionOrder;

	return (
		<div className="grid gap-5 rounded-xl border border-line bg-surface p-4">
			<div className="flex flex-wrap items-end gap-3">
				<div className="grid min-w-52 flex-1 gap-1">
					<label htmlFor={`${id}-name`} className="text-xs font-medium text-ink-2">
						<Trans>Name</Trans>
					</label>
					<Input
						id={`${id}-name`}
						value={preset.name}
						maxLength={60}
						onChange={(event) => set({ name: event.target.value })}
					/>
				</div>
				{!isDefault && (
					<Button size="sm" variant="secondary" onClick={onMakeDefault}>
						<Trans>Make default</Trans>
					</Button>
				)}
				{onRemove && <IconButton icon="trash" size="icon-sm" label={t`Remove ${preset.name}`} onClick={onRemove} />}
			</div>
			<ChipField
				label={t`Picked for posting titles containing`}
				placeholder={t`Add a word, then Enter`}
				value={preset.keywords}
				onChange={(keywords) => set({ keywords: keywords.slice(0, 12) })}
			/>

			<fieldset className="grid gap-3">
				<legend className="mb-1 text-sm font-semibold">
					<Trans>Voice</Trans>
				</legend>
				<div className="grid gap-3 sm:grid-cols-3">
					<SelectField
						label={t`Tone`}
						value={preset.tone}
						onChange={(tone) => set({ tone })}
						options={[
							["plain", t`Plain and direct`],
							["warm", t`Warm, people-first`],
							["confident", t`Confident`],
							["formal", t`Formal`],
						]}
					/>
					<SelectField
						label={t`Bullet style`}
						value={preset.bulletStyle}
						onChange={(bulletStyle) => set({ bulletStyle })}
						options={[
							["action-result", t`Action, then result`],
							["challenge-action-result", t`Challenge, action, result`],
							["concise", t`One tight line`],
						]}
					/>
					<SelectField
						label={t`Information density`}
						value={preset.density}
						onChange={(density) => set({ density })}
						options={[
							["light", t`Light`],
							["balanced", t`Balanced`],
							["dense", t`Detailed`],
						]}
					/>
					<SelectField<WritingRegion>
						label={t`Regional conventions`}
						value={rules.region}
						onChange={(region) => setRules({ region })}
						options={WRITING_REGIONS.map((region) => [region, REGION_CONVENTIONS[region].label])}
					/>
				</div>
				<p className="text-xs text-ink-3">{REGION_CONVENTIONS[rules.region].personalDetails}.</p>
				<div className="grid gap-1">
					<label htmlFor={`${id}-notes`} className="text-xs font-medium text-ink-2">
						<Trans>Anything else, in your words</Trans>
					</label>
					<Textarea
						id={`${id}-notes`}
						rows={2}
						maxLength={1000}
						value={preset.notes}
						placeholder={t`No first person. Use "led" sparingly.`}
						onChange={(event) => set({ notes: event.target.value })}
					/>
				</div>
			</fieldset>

			<fieldset className="grid gap-3">
				<legend className="mb-1 text-sm font-semibold">
					<Trans>Length</Trans>
				</legend>
				<div className="flex flex-wrap gap-4">
					<NumberField
						label={t`Pages, experienced`}
						value={rules.pages.experienced}
						min={1}
						max={4}
						onChange={(experienced) => setRules({ pages: { ...rules.pages, experienced } })}
					/>
					<NumberField
						label={t`Pages, early career`}
						value={rules.pages.early}
						min={1}
						max={4}
						onChange={(early) => setRules({ pages: { ...rules.pages, early } })}
					/>
					<NumberField
						label={t`Experienced from (years)`}
						value={rules.pages.experiencedYears}
						min={0}
						max={30}
						onChange={(experiencedYears) => setRules({ pages: { ...rules.pages, experiencedYears } })}
					/>
					<NumberField
						label={t`Positions, usually from`}
						value={rules.positions.min}
						min={1}
						max={10}
						onChange={(min) => setRules({ positions: { ...rules.positions, min } })}
					/>
					<NumberField
						label={t`to`}
						value={rules.positions.max}
						min={1}
						max={12}
						onChange={(max) => setRules({ positions: { ...rules.positions, max } })}
					/>
				</div>
				<div className="flex flex-wrap gap-4">
					<NumberField
						label={t`Bullets, major roles from`}
						value={rules.bullets.majorMin}
						min={1}
						max={8}
						onChange={(majorMin) => setRules({ bullets: { ...rules.bullets, majorMin } })}
					/>
					<NumberField
						label={t`to`}
						value={rules.bullets.majorMax}
						min={1}
						max={10}
						onChange={(majorMax) => setRules({ bullets: { ...rules.bullets, majorMax } })}
					/>
					<NumberField
						label={t`Bullets, other roles up to`}
						value={rules.bullets.otherMax}
						min={0}
						max={8}
						onChange={(otherMax) => setRules({ bullets: { ...rules.bullets, otherMax } })}
					/>
					<NumberField
						label={t`Words per bullet, at most`}
						value={rules.bullets.maxWords}
						min={10}
						max={80}
						onChange={(maxWords) => setRules({ bullets: { ...rules.bullets, maxWords } })}
					/>
				</div>
				<div className="flex flex-wrap items-end gap-4">
					<NumberField
						label={t`Recent means the last (years)`}
						value={preset.recentYears}
						min={1}
						max={40}
						onChange={(recentYears) => set({ recentYears })}
					/>
					<SelectField
						label={t`Older roles`}
						value={preset.olderRoles}
						onChange={(olderRoles) => set({ olderRoles })}
						options={[
							["brief", t`Keep them brief`],
							["full", t`Same detail as recent ones`],
						]}
					/>
				</div>
				<p className="text-xs text-ink-3">
					<Trans>
						These guide the writer and the checks. Nothing you chose is cut, and text is never shrunk to fit.
					</Trans>
				</p>
			</fieldset>

			<fieldset className="grid gap-3">
				<legend className="mb-1 text-sm font-semibold">
					<Trans>Summary and headline</Trans>
				</legend>
				<SwitchRow
					label={t`Write a professional summary`}
					checked={rules.summary.enabled}
					onCheckedChange={(enabled) => setRules({ summary: { ...rules.summary, enabled } })}
				/>
				{rules.summary.enabled && (
					<div className="flex flex-wrap gap-4">
						<NumberField
							label={t`Sentences, from`}
							value={rules.summary.minSentences}
							min={1}
							max={6}
							onChange={(minSentences) => setRules({ summary: { ...rules.summary, minSentences } })}
						/>
						<NumberField
							label={t`to`}
							value={rules.summary.maxSentences}
							min={1}
							max={6}
							onChange={(maxSentences) => setRules({ summary: { ...rules.summary, maxSentences } })}
						/>
						<NumberField
							label={t`Words, at most`}
							value={rules.summary.maxWords}
							min={20}
							max={200}
							onChange={(maxWords) => setRules({ summary: { ...rules.summary, maxWords } })}
						/>
					</div>
				)}
				<SwitchRow
					label={t`Write a targeted headline`}
					description={t`Built only from your own titles, sector and skills.`}
					checked={rules.headline}
					onCheckedChange={(headline) => setRules({ headline })}
				/>
			</fieldset>

			<fieldset className="grid gap-3">
				<legend className="mb-1 text-sm font-semibold">
					<Trans>Skills</Trans>
				</legend>
				<div className="flex flex-wrap gap-4">
					<NumberField
						label={t`Skills, about`}
						value={rules.skills.min}
						min={0}
						max={30}
						onChange={(min) => setRules({ skills: { ...rules.skills, min } })}
					/>
					<NumberField
						label={t`to`}
						value={rules.skills.max}
						min={1}
						max={40}
						onChange={(max) => setRules({ skills: { ...rules.skills, max } })}
					/>
					<NumberField
						label={t`Groups, from`}
						value={rules.skills.minGroups}
						min={1}
						max={6}
						onChange={(minGroups) => setRules({ skills: { ...rules.skills, minGroups } })}
					/>
					<NumberField
						label={t`to`}
						value={rules.skills.maxGroups}
						min={1}
						max={8}
						onChange={(maxGroups) => setRules({ skills: { ...rules.skills, maxGroups } })}
					/>
				</div>
				<ChipField
					label={t`Group names to prefer`}
					placeholder={t`Add a name, then Enter`}
					value={preset.skillGroupHints}
					onChange={(skillGroupHints) => set({ skillGroupHints: skillGroupHints.slice(0, 6) })}
				/>
			</fieldset>

			<fieldset className="grid gap-2">
				<legend className="mb-1 text-sm font-semibold">
					<Trans>Section order</Trans>
				</legend>
				<SwitchRow
					label={t`Use each selection's recommended order`}
					description={t`Off: always use the order below.`}
					checked={order === null}
					onCheckedChange={(recommended) => set({ sectionOrder: recommended ? null : [...SELECTION_SECTIONS] })}
				/>
				{order && (
					<ol className="grid gap-1">
						{order.map((section, index) => (
							<li
								key={section}
								className="flex items-center gap-2 rounded-md border border-line-2 px-2.5 py-1 text-[13px]"
							>
								<span className="w-5 text-ink-3">{index + 1}</span>
								<span className="flex-1">{sections[section]}</span>
								<IconButton
									icon="arrow-up"
									size="icon-xs"
									label={t`Move ${sections[section]} up`}
									disabled={index === 0}
									onClick={() => {
										const next = [...order];
										next.splice(index - 1, 0, ...next.splice(index, 1));
										set({ sectionOrder: next });
									}}
								/>
								<IconButton
									icon="arrow-down"
									size="icon-xs"
									label={t`Move ${sections[section]} down`}
									disabled={index === order.length - 1}
									onClick={() => {
										const next = [...order];
										next.splice(index + 1, 0, ...next.splice(index, 1));
										set({ sectionOrder: next });
									}}
								/>
							</li>
						))}
					</ol>
				)}
			</fieldset>

			<fieldset className="grid gap-2">
				<legend className="mb-1 text-sm font-semibold">
					<Trans>Write like these examples</Trans>
				</legend>
				{guide.examples.length === 0 ? (
					<p className="text-xs text-ink-3">
						<Trans>Add examples below, then choose up to three for this preset.</Trans>
					</p>
				) : (
					guide.examples.map((example) => {
						const on = preset.exampleIds.includes(example.id);
						return (
							<button
								key={example.id}
								type="button"
								aria-pressed={on}
								disabled={!on && preset.exampleIds.length >= 3}
								onClick={() =>
									set({
										exampleIds: on
											? preset.exampleIds.filter((item) => item !== example.id)
											: [...preset.exampleIds, example.id],
									})
								}
								className="flex items-center gap-2 justify-self-start rounded-md border border-line-2 px-2.5 py-1 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-50 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink"
							>
								{on && <Icon name="check" size={14} />}
								{example.title}
							</button>
						);
					})
				)}
			</fieldset>
		</div>
	);
}

type ExamplesSectionProps = { guide: ResumeStyleGuide; onChange: (guide: ResumeStyleGuide) => void };

/** Resumes the user thinks are well written. Their text guides voice and shape only. */
function ExamplesSection({ guide, onChange }: ExamplesSectionProps) {
	const queryClient = useQueryClient();
	const id = useId();
	const file = useRef<HTMLInputElement>(null);
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const resumes = (documents ?? []).filter((document) => document.type === "resume");
	const [resumeId, setResumeId] = useState("");
	const added = (example: ResumeStyleGuide["examples"][number]) => {
		// Added on the server already; merge into the draft so unsaved edits stay.
		onChange({ ...guide, examples: [...guide.examples, example] });
		void queryClient.invalidateQueries({ queryKey: orpc.resumeStyle.get.queryKey() });
		toast.add({ description: t`Example added` });
	};
	const fromResume = useMutation({
		...orpc.resumeStyle.addExampleFromResume.mutationOptions(),
		onSuccess: added,
		onError: (error) => toastError(error, t`Couldn't add that resume. Try again.`, { allowServerMessage: true }),
	});
	const fromFile = useMutation({
		...orpc.resumeStyle.addExampleFromFile.mutationOptions(),
		onSuccess: added,
		onError: (error) => toastError(error, t`Couldn't read that file. Use a PDF with selectable text or a Word file.`),
	});
	const full = guide.examples.length >= 6;
	const setExample = (exampleId: string, patch: { title?: string; notes?: string }) =>
		onChange({
			...guide,
			examples: guide.examples.map((example) => (example.id === exampleId ? { ...example, ...patch } : example)),
		});

	return (
		<SettingsSection
			title={<Trans>Examples you like</Trans>}
			description={
				<Trans>
					Up to six resumes you think are well written: yours or anyone's. Only their style is used — never their
					content or facts.
				</Trans>
			}
		>
			<div className="flex flex-wrap items-end gap-2">
				<div className="grid min-w-56 gap-1">
					<label htmlFor={`${id}-resume`} className="text-xs font-medium text-ink-2">
						<Trans>From your resumes</Trans>
					</label>
					<NativeSelect id={`${id}-resume`} value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
						<option value="">{t`Choose a resume`}</option>
						{resumes.map((resume) => (
							<option key={resume.id} value={resume.id}>
								{resume.name}
							</option>
						))}
					</NativeSelect>
				</div>
				<Button
					variant="secondary"
					disabled={!resumeId || full}
					loading={fromResume.isPending}
					onClick={() => fromResume.mutate({ resumeId })}
				>
					<Trans>Add</Trans>
				</Button>
				<Button variant="secondary" disabled={full} loading={fromFile.isPending} onClick={() => file.current?.click()}>
					{!fromFile.isPending && <Icon name="file-arrow-up" size={16} />}
					<Trans>Upload PDF or Word file</Trans>
				</Button>
				<input
					ref={file}
					type="file"
					hidden
					accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
					onChange={(event) => {
						const picked = event.target.files?.[0];
						event.target.value = "";
						if (picked) fromFile.mutate({ file: picked });
					}}
				/>
			</div>
			{guide.examples.length > 0 && (
				<ul className="grid gap-2">
					{guide.examples.map((example) => (
						<li key={example.id} className={cn("grid gap-2 rounded-lg border border-line px-3 py-2.5")}>
							<div className="flex items-center gap-2">
								<Input
									aria-label={t`Example name`}
									value={example.title}
									maxLength={120}
									onChange={(event) => setExample(example.id, { title: event.target.value })}
									className="h-8 flex-1"
								/>
								<span className="text-xs whitespace-nowrap text-ink-3">
									{example.source === "resume" ? t`From your resumes` : t`Uploaded`} ·{" "}
									{plural(example.text.split(/\s+/).length, { one: "# word", other: "# words" })}
								</span>
								<IconButton
									icon="trash"
									size="icon-sm"
									label={t`Remove ${example.title}`}
									onClick={() =>
										onChange({
											...guide,
											examples: guide.examples.filter((item) => item.id !== example.id),
											presets: guide.presets.map((preset) => ({
												...preset,
												exampleIds: preset.exampleIds.filter((item) => item !== example.id),
											})),
										})
									}
								/>
							</div>
							<Input
								aria-label={t`What you like about it`}
								value={example.notes}
								maxLength={500}
								placeholder={t`What you like about it (optional)`}
								onChange={(event) => setExample(example.id, { notes: event.target.value })}
								className="h-8"
							/>
						</li>
					))}
				</ul>
			)}
		</SettingsSection>
	);
}
