// Countdown Creative tokens for React Native (rebrand spec v1; same values as packages/ui globals.css).
// Screens use these and nothing else; add a missing token here rather than hard-coding a value.
import { Easing, Platform } from "react-native";

export type ColorScheme = "light" | "dark";

// §1 Colours and §1.1 named tints. Alpha is the last two hex digits (#RRGGBBAA).
const light = {
	bg: "#F4EFE9",
	surface: "#FDFCFB",
	raised: "#FFFFFF",
	sunken: "#ECE5DE",
	line: "#ECE5DE",
	line2: "#D3C7BB",
	lineStrong: "#8A7C70",
	ink: "#1E1A17",
	ink2: "#4A423C",
	ink3: "#5C534C",
	accent: "#FF7739",
	accentHover: "#E85F1E",
	onAccent: "#FFFFFF",
	accentSoft: "#FFF7F2",
	accentText: "#C44E14",
	danger: "#D2605A",
	dangerSoft: "#FBEBEB",
	dangerText: "#B3413B",
	warn: "#D9A33A",
	warnSoft: "#FDF3D9",
	warnText: "#8A6410",
	infoSoft: "#EAF1FB",
	infoText: "#3B6AB3",
	hover: "#1E1A170D",
	press: "#1E1A1717",
	scrim: "#1E140A52",
	scrimSheet: "#1E140A2E",
	paper: "#FFFFFF",
	paperInk: "#1E1A17",
	paperLine: "#ECE5DE",
	paperAccent: "#FF7739",
	paperWarn: "#D9A33A",
	paperWarnSoft: "#FDF3D9",
	stageSaved: "#8A7C70",
	stageApplied: "#5E7FAE",
	stageScreen: "#3E7C78",
	stageInterv: "#C99A2E",
	stageOffer: "#4E9A6C",
	stageClosed: "#8A5A7C",
	pageSelectFill: "#FF77391F",
	pageSelectLine: "#FF7739",
	pageIssueFill: "#D9A33A38",
	pageProposalFill: "#FF77391F",
	selectedFill: "#FFF7F2",
	success: "#4E9A6C",
	successSoft: "#EAF4EE",
	successText: "#2E7D4F",
	focus: "#FF9660",
};

export type ColorToken = keyof typeof light;
export type Colors = Record<ColorToken, string>;

const dark: Colors = {
	bg: "#1C1815",
	surface: "#241F1B",
	raised: "#2A2420",
	sunken: "#171310",
	line: "#3A322C",
	line2: "#5E544C",
	lineStrong: "#958879",
	ink: "#F6F1EC",
	ink2: "#C2B6AB",
	ink3: "#A09387",
	accent: "#FF7739",
	accentHover: "#FF8A52",
	onAccent: "#FFFFFF",
	accentSoft: "#33221A",
	accentText: "#FF9660",
	danger: "#E0726B",
	dangerSoft: "#3A211F",
	dangerText: "#EC8B85",
	warn: "#E0AE48",
	warnSoft: "#31280F",
	warnText: "#E3BC67",
	infoSoft: "#1D2838",
	infoText: "#8FB0E3",
	hover: "#F6F1EC0F",
	press: "#F6F1EC1A",
	scrim: "#0C080580",
	scrimSheet: "#0C080580",
	paper: "#FFFFFF",
	paperInk: "#1E1A17",
	paperLine: "#ECE5DE",
	paperAccent: "#FF7739",
	paperWarn: "#D9A33A",
	paperWarnSoft: "#FDF3D9",
	stageSaved: "#A09387",
	stageApplied: "#86A6D6",
	stageScreen: "#5FA8A2",
	stageInterv: "#DDB25A",
	stageOffer: "#5DB081",
	stageClosed: "#B985A9",
	pageSelectFill: "#FF77392E",
	pageSelectLine: "#FF7739",
	pageIssueFill: "#E0AE4838",
	pageProposalFill: "#FF77392E",
	selectedFill: "#33221A",
	success: "#5DB081",
	successSoft: "#1E2D24",
	successText: "#7CC49A",
	focus: "#FF9660",
};

export const colors: Record<ColorScheme, Colors> = { light, dark };

// §2 Type. Custom fonts select weight by family name (Android ignores fontWeight for them), so each weight is its
// own family, loaded under these names in src/ui/fonts.ts.
export const fonts = {
	ui: {
		400: "Manrope-Regular",
		500: "Manrope-Medium",
		600: "Manrope-SemiBold",
		700: "Manrope-Bold",
	},
	/** Space Grotesk 700 is the only display cut bundled (titles use weight, never italic); don't pair it with fontWeight. */
	display: {
		400: "SpaceGrotesk-Bold",
	},
	/** The system's monospace, for codes and addresses only. */
	mono: {
		400: Platform.select({ ios: "Menlo", default: "monospace" }),
	},
} as const;

type TextStyleToken = {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	letterSpacing: number;
	maxFontSizeMultiplier?: number;
};

export const type = {
	largeIOS: { fontFamily: fonts.display[400], fontSize: 34, lineHeight: 41, letterSpacing: -0.68 },
	largeAnd: { fontFamily: fonts.display[400], fontSize: 28, lineHeight: 34, letterSpacing: -0.56 },
	display: { fontFamily: fonts.display[400], fontSize: 28, lineHeight: 34, letterSpacing: -0.56 },
	heading: { fontFamily: fonts.display[400], fontSize: 22, lineHeight: 28, letterSpacing: -0.44 },
	title: { fontFamily: fonts.ui[600], fontSize: 17, lineHeight: 22, letterSpacing: 0 },
	bodyLarge: { fontFamily: fonts.ui[400], fontSize: 16, lineHeight: 22, letterSpacing: 0 },
	body: { fontFamily: fonts.ui[400], fontSize: 15, lineHeight: 21, letterSpacing: 0 },
	label: { fontFamily: fonts.ui[600], fontSize: 15, lineHeight: 20, letterSpacing: 0 },
	callout: { fontFamily: fonts.ui[400], fontSize: 13, lineHeight: 18, letterSpacing: 0 },
	caption: { fontFamily: fonts.ui[500], fontSize: 12, lineHeight: 16, letterSpacing: 0 },
	micro: { fontFamily: fonts.ui[600], fontSize: 11, lineHeight: 13, letterSpacing: 0.1, maxFontSizeMultiplier: 1.6 },
	mono: { fontFamily: fonts.mono[400], fontSize: 13, lineHeight: 18, letterSpacing: 0 },
	/** Section labels and eyebrows: Manrope 700, 11pt, widely tracked; set textTransform uppercase where used. */
	eyebrow: {
		fontFamily: fonts.ui[700],
		fontSize: 11,
		lineHeight: 16,
		letterSpacing: 1.2,
		maxFontSizeMultiplier: 1.6,
	},
} satisfies Record<string, TextStyleToken>;

/** `pageThumb`: Space Grotesk 700 that scales with the letter card, 3.3% of its width. */
export const pageThumb = { fontFamily: fonts.display[400], widthRatio: 0.033 } as const;

// §3 Spacing, 4 pt grid.
export const space = { s0: 2, s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s10: 40, s12: 48 } as const;

// §3.1 Sizes.
export const size = {
	hit: 44,
	row: 52,
	input: 46,
	button: 48,
	chip: 32,
	tabBar: 52,
	topBar: 44,
	editorBar: 56,
	newPill: { width: 34, height: 26 },
	grabber: { width: 36, height: 5 },
	sidebar: 240,
	panel: 400,
	formSheet: 540,
	sheetShare: 440,
	sheetDetail: 480,
	/** Phosphor sizes: inline meta 16, list rows 20, toolbars 22, tab bar and nav bar 24. */
	icon: { meta: 16, row: 20, toolbar: 22, bar: 24 },
} as const;

// §4 Radii.
export const radius = {
	/** Tags and small marks. */
	rSm: 6,
	/** Controls: buttons, inputs, nav rows. */
	rMd: 7,
	/** Cards, sheets and other larger shapes. Only status chips are full pills. */
	rLg: 14,
} as const;

// §5 Shadows. `boxShadow` first; `ios` and `elevation` are the legacy fallback for Android below API 28.
type ShadowToken = {
	boxShadow: string;
	ios: {
		shadowColor: string;
		shadowOffset: { width: number; height: number };
		shadowOpacity: number;
		shadowRadius: number;
	};
	elevation: number;
};

export const shadows: Record<ColorScheme, Record<"e1" | "e2" | "e3" | "ePage", ShadowToken>> = {
	light: {
		e1: {
			boxShadow: "0 1px 2px #2E201412",
			ios: { shadowColor: "#2E2014", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 1 },
			elevation: 1,
		},
		e2: {
			boxShadow: "0 1px 2px #2E20140F, 0 10px 28px -8px #2E20142E",
			ios: { shadowColor: "#2E2014", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 12 },
			elevation: 4,
		},
		e3: {
			boxShadow: "0 2px 6px #2E201414, 0 28px 64px -16px #2E20144D",
			ios: { shadowColor: "#2E2014", shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.22, shadowRadius: 28 },
			elevation: 12,
		},
		ePage: {
			boxShadow: "0 1px 2px #2E201414, 0 12px 36px -12px #2E201440",
			ios: { shadowColor: "#2E2014", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 14 },
			elevation: 3,
		},
	},
	dark: {
		e1: {
			boxShadow: "0 1px 2px #00000066",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 1 },
			elevation: 1,
		},
		e2: {
			boxShadow: "0 1px 2px #00000066, 0 12px 32px -8px #0000008C",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12 },
			elevation: 4,
		},
		e3: {
			boxShadow: "0 2px 6px #00000066, 0 28px 64px -12px #000000B3",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.6, shadowRadius: 28 },
			elevation: 12,
		},
		ePage: {
			boxShadow: "0 1px 2px #00000066, 0 12px 36px -12px #00000099",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 14 },
			elevation: 3,
		},
	},
};

// §6 Motion. With reduced motion on, d1–d3 become 0 for movement (see tokens.md §6).
export const motion = {
	d1: 120,
	d2: 180,
	d3: 240,
	ease: Easing.bezier(0.2, 0.6, 0.3, 1),
	easeMove: Easing.bezier(0.77, 0, 0.175, 1),
	easeDrawer: Easing.bezier(0.32, 0.72, 0, 1),
} as const;
