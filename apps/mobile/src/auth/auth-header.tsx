import { useLingui } from "@lingui/react/macro";
import { openBrowserAsync } from "expo-web-browser";
import { View } from "react-native";
import { Brand, Button, Text, showToast, useTheme } from "@/ui";

type AuthHeaderProps = {
	subtitle?: string | undefined;
};

/** The Countdown Creative mark and the app name at the top of the sign-in screens. */
export function AuthHeader({ subtitle }: AuthHeaderProps) {
	const { t } = useLingui();
	const { space } = useTheme();

	return (
		<View style={{ alignItems: "center", gap: space.s4, paddingHorizontal: space.s2 }}>
			<View style={{ marginBottom: space.s2 }}>
				<Brand variant="mark" size={space.s12 * 2} />
			</View>
			<Text variant="display" align="center" accessibilityRole="header">
				{t`Resume Builder`}
			</Text>
			{subtitle ? (
				<Text color="ink2" align="center">
					{subtitle}
				</Text>
			) : null}
		</View>
	);
}

export function PrivacyPolicyLink() {
	const { t } = useLingui();
	return (
		<View style={{ alignSelf: "center" }}>
			<Button
				label={t`Privacy policy`}
				variant="link"
				onPress={() => {
					void openBrowserAsync("https://docs.rxresu.me/legal/privacy-policy").catch(() =>
						showToast({ message: t`Couldn't open the browser. Try again.` }),
					);
				}}
			/>
		</View>
	);
}

/** The host of an origin, as people type it: `https://rxresu.me` → `rxresu.me`. */
export const hostOf = (origin: string) => origin.replace(/^https?:\/\//, "");
