// Preference checks (web features/career/preference-check.tsx): how a role reads against Preferences, computed
// on the server without AI. Must-haves rule a role out only when the posting confirms them unmet.
import type { PreferenceCheck, PreferenceEvaluation } from "@reactive-resume/schema/career-preferences";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { orpc } from "@/api/client";
import { Button, Icon, Text, showToast, useTheme } from "@/ui";

function useVerdicts() {
	const { t } = useLingui();
	return {
		fits: { label: t`Fits your must-haves`, tone: "accent" },
		check: { label: t`Check before applying`, tone: "warn" },
		conflict: { label: t`Misses a must-have`, tone: "danger" },
	} as const;
}

type VerdictBadgeProps = { verdict: PreferenceEvaluation["verdict"] };

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
	const { colors, radius, space } = useTheme();
	const { label, tone } = useVerdicts()[verdict];
	const background = { accent: colors.accentSoft, warn: colors.warnSoft, danger: colors.dangerSoft }[tone];
	const foreground = { accent: colors.accentText, warn: colors.warnText, danger: colors.dangerText }[tone];
	return (
		<View
			style={{
				alignSelf: "flex-start",
				backgroundColor: background,
				borderRadius: radius.rSm,
				paddingHorizontal: space.s2,
				paddingVertical: space.s0,
			}}
		>
			<Text variant="caption" style={{ color: foreground }}>
				{label}
			</Text>
		</View>
	);
}

type PreferenceChecksProps = {
	checks: PreferenceCheck[];
	onToggle?: ((check: PreferenceCheck) => void) | undefined;
	pending?: string | null | undefined;
};

export function PreferenceChecks({ checks, onToggle, pending }: PreferenceChecksProps) {
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const priority = { must: t`Must have`, strong: t`Strong preference`, nice: t`Nice to have` };
	const icons = {
		met: { name: "check-circle", color: colors.accentText, label: t`Met` },
		violated: { name: "x-circle", color: colors.dangerText, label: t`Not met` },
		unknown: { name: "question", color: colors.warnText, label: t`Not stated` },
		overridden: { name: "minus", color: colors.ink3, label: t`Set aside for this role` },
	} as const;
	return (
		<View style={{ gap: space.s3 }}>
			{checks.map((check) => (
				<View key={check.key} style={{ flexDirection: "row", gap: space.s2 }}>
					<View accessible accessibilityLabel={icons[check.status].label}>
						<Icon name={icons[check.status].name} size={18} color={icons[check.status].color} />
					</View>
					<View style={{ flex: 1, gap: space.s1 }}>
						<Text>
							<Text
								variant="label"
								style={check.status === "overridden" ? { textDecorationLine: "line-through" } : undefined}
							>
								{check.label}
							</Text>
							<Text variant="caption" color="ink3">
								{` · ${priority[check.priority]}${check.legacy ? ` · ${t`from your earlier settings`}` : ""}`}
							</Text>
						</Text>
						<Text color="ink2">{check.detail}</Text>
						{onToggle && check.status !== "met" ? (
							<View style={{ alignSelf: "flex-start" }}>
								<Button
									variant="ghost"
									size="sm"
									label={check.status === "overridden" ? t`Count it again` : t`Doesn't matter here`}
									loading={pending === check.key}
									onPress={() => onToggle(check)}
								/>
							</View>
						) : null}
					</View>
				</View>
			))}
		</View>
	);
}

type RoleVerdictProps = { evaluation: PreferenceEvaluation };

/** For a discovered role: the verdict and why; the checks open on request. */
export function RoleVerdict({ evaluation }: RoleVerdictProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [open, setOpen] = useState(false);
	if (evaluation.checks.length === 0) return null;
	return (
		<View style={{ gap: space.s2 }}>
			<VerdictBadge verdict={evaluation.verdict} />
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				accessibilityHint={open ? t`Hides the checks` : t`Shows each preference checked`}
				onPress={() => setOpen((value) => !value)}
				style={{ flexDirection: "row", gap: space.s1, alignItems: "flex-start" }}
			>
				<Text color="ink2" style={{ flex: 1 }}>
					{evaluation.summary}
				</Text>
				<View style={open ? { transform: [{ rotate: "180deg" }] } : undefined}>
					<Icon name="caret-down" size={16} />
				</View>
			</Pressable>
			{open ? <PreferenceChecks checks={evaluation.checks} /> : null}
		</View>
	);
}

type PreferencesBlockProps = { applicationId: string };

/** One application against Preferences, where any preference can be set aside for this role. */
export function PreferencesBlock({ applicationId }: PreferencesBlockProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const options = orpc.careerPreferences.evaluateApplication.queryOptions({ input: { applicationId } });
	const query = useQuery(options);
	const toggle = useMutation({
		...orpc.careerPreferences.setOverride.mutationOptions(),
		onSuccess: (evaluation) => queryClient.setQueryData(options.queryKey, evaluation),
		onError: () => showToast({ message: t`Couldn't update this preference. Try again.` }),
	});
	const evaluation = query.data;
	if (!evaluation) return null;
	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="label" accessibilityRole="header">
				{t`Against your preferences`}
			</Text>
			{evaluation.checks.length === 0 ? (
				<Text color="ink2">{t`No preferences to check yet. Set them in Knowledge → Preferences.`}</Text>
			) : (
				<>
					<VerdictBadge verdict={evaluation.verdict} />
					<Text color="ink2">
						{evaluation.summary}
						{evaluation.rule ? ` ${t`Using your rule for ${evaluation.rule.label}.`}` : ""}
					</Text>
					<PreferenceChecks
						checks={evaluation.checks}
						pending={toggle.isPending ? toggle.variables.key : null}
						onToggle={(check) =>
							toggle.mutate({ applicationId, key: check.key, overridden: check.status !== "overridden" })
						}
					/>
				</>
			)}
		</View>
	);
}
