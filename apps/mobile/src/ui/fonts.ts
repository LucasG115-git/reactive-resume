// The UI fonts, bundled with the app (Google Fonts static files; OFL notices next to them). Loaded under the family
// names `tokens.fonts` uses. Mono is the system's, so it isn't bundled.
import { fonts } from "./tokens";

export const fontAssets = {
	[fonts.ui[400]]: require("../../assets/fonts/Manrope-Regular.ttf"),
	[fonts.ui[500]]: require("../../assets/fonts/Manrope-Medium.ttf"),
	[fonts.ui[600]]: require("../../assets/fonts/Manrope-SemiBold.ttf"),
	[fonts.ui[700]]: require("../../assets/fonts/Manrope-Bold.ttf"),
	[fonts.display[400]]: require("../../assets/fonts/SpaceGrotesk-Bold.ttf"),
};
