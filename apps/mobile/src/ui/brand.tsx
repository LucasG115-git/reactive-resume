import { Image } from "expo-image";
import { useTheme } from "./theme";

type BrandProps = {
	/** `logo`: the Countdown Creative lockup, sized by height; `mark`: the rocket mark, square. */
	variant?: "logo" | "mark";
	size: number;
};

const mark = require("../../assets/brand/mark.png");
const logos = {
	light: require("../../assets/brand/logo-light.png"),
	dark: require("../../assets/brand/logo-dark.png"),
};
/** The lockup's width over its height. */
const LOGO_RATIO = 1586 / 464;

/** The Countdown Creative brand: the mark is orange on any surface; the lockup's wordmark follows the theme. */
export function Brand({ variant = "logo", size }: BrandProps) {
	const { scheme } = useTheme();
	if (variant === "mark")
		return <Image source={mark} accessible={false} contentFit="contain" style={{ width: size, height: size }} />;
	return (
		<Image
			source={logos[scheme]}
			accessible={false}
			contentFit="contain"
			style={{ width: size * LOGO_RATIO, height: size }}
		/>
	);
}
