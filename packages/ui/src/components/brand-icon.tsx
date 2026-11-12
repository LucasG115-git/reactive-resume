import { cn } from "@reactive-resume/utils/style";

type Props = React.ComponentProps<"img"> & {
	/** `logo`: the Countdown Creative lockup (mark and wordmark); `icon`: the rocket mark alone. */
	variant?: "logo" | "icon";
};

/**
 * The Countdown Creative brand. The mark is orange on any surface, so it's one image; the lockup's wordmark is dark ink
 * in the light theme and the knockout (light) version in the dark theme. Size the lockup by height (`h-*`, `w-auto`).
 */
export function BrandIcon({ variant = "logo", className, alt = "Countdown Creative", ...props }: Props) {
	if (variant === "icon")
		return <img src="/icon/mark.png" alt={alt} className={cn("size-12 object-contain", className)} {...props} />;
	return (
		<>
			<img
				src="/logo/dark.png"
				alt={alt}
				className={cn("hidden h-12 w-auto object-contain dark:block", className)}
				{...props}
			/>
			<img
				src="/logo/light.png"
				alt={alt}
				className={cn("block h-12 w-auto object-contain dark:hidden", className)}
				{...props}
			/>
		</>
	);
}
