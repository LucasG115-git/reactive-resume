import * as React from "react";
import {
	Body,
	Button,
	Container,
	Font,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	pixelBasedPreset,
	Section,
	Tailwind,
	Text,
} from "react-email";

// ponytail: server dev consumes this source through tsx, which emits React.createElement here.
void React;

const appName = "Resume Builder";
// The Countdown Creative lockup, served by the instance that sent the email (the action link's origin).
const logoUrlFor = (actionUrl: string) => {
	try {
		return `${new URL(actionUrl).origin}/logo/light.png`;
	} catch {
		return null;
	}
};

interface AuthEmailLayoutProps {
	preview: string;
	heading: string;
	intro: string;
	details?: string;
	actionLabel: string;
	actionUrl: string;
	outro: string;
}

function AuthEmailLayout({ preview, heading, intro, details, actionLabel, actionUrl, outro }: AuthEmailLayoutProps) {
	return (
		<Html lang="en">
			<Tailwind
				config={{
					presets: [pixelBasedPreset],
					theme: {
						fontFamily: {
							// Many mail clients ignore web fonts: Arial is what most people see.
							body: ["Manrope", "Arial", "sans-serif"],
							heading: ["Manrope", "Arial", "sans-serif"],
						},
					},
				}}
			>
				<Head>
					<Font
						fontFamily="Manrope"
						fallbackFontFamily="Arial"
						fontWeight={400}
						fontStyle="normal"
						webFont={{
							url: "https://fonts.gstatic.com/s/manrope/v23/xn7gYHE41ni1AdIRggexSg.woff2",
							format: "woff2",
						}}
					/>
				</Head>

				<Body className="font-body m-0 bg-[#F4EFE9] p-0 text-sm text-[#1E1A17]">
					<Preview>{preview}</Preview>
					<Container className="mx-auto w-full max-w-xl rounded-[14px] border border-solid border-[#ECE5DE] bg-white p-6 text-[#1E1A17]">
						<Section>
							{logoUrlFor(actionUrl) ? (
								<Img
									src={logoUrlFor(actionUrl) ?? ""}
									alt="Countdown Creative"
									height="40"
									className="block h-10 w-auto"
								/>
							) : null}
						</Section>

						<Section className="mt-6">
							<Heading className="font-heading text-2xl leading-0 font-bold tracking-tight whitespace-break-spaces md:text-4xl">
								{heading}
							</Heading>

							<Section className="mt-6 md:mt-12">
								<Text>{intro}</Text>

								{details ? <Text className="text-[#4A423C]">{details}</Text> : null}
							</Section>

							<Button
								target="_blank"
								href={actionUrl}
								className="mt-6 box-border inline-block rounded-[7px] bg-[#FF7739] px-6 py-3 text-center font-bold text-white no-underline"
							>
								{actionLabel}
							</Button>

							<Section className="mt-8">
								<Text className="leading-0">
									If the button does not work, copy and paste this link into your browser:
								</Text>
								<Link className="leading-0 text-[#C44E14] underline underline-offset-2" href={actionUrl}>
									{actionUrl}
								</Link>
							</Section>

							<Section className="mt-4">
								<Text className="text-[#4A423C]">{outro}</Text>
							</Section>

							<Hr className="my-10 border-[#ECE5DE]" />

							<Text className="mt-8 text-xs leading-1 text-[#5C534C]">
								Built on Reactive Resume, by the community, for the community.
							</Text>
							<Text className="text-xs leading-1 text-[#5C534C]">
								A passion project by{" "}
								<Link
									target="_blank"
									rel="noopener noreferrer"
									href="https://amruthpillai.com"
									className="text-inherit underline underline-offset-2"
								>
									Amruth Pillai
								</Link>
								.
							</Text>

							<Text className="font-heading mt-8 text-base font-bold tracking-tight text-[#4A423C]">
								Resume Builder
							</Text>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}

interface ResetPasswordEmailProps {
	url: string;
}

export function ResetPasswordEmail({ url }: ResetPasswordEmailProps) {
	return (
		<AuthEmailLayout
			preview={`Reset your ${appName} password`}
			heading="Reset your password"
			intro={`We received a request to reset your ${appName} password.`}
			details="If this was not you, you can ignore this message and your password will remain unchanged."
			actionLabel="Create new password"
			actionUrl={url}
			outro="For security, only use links from emails sent by Resume Builder."
		/>
	);
}

interface VerifyEmailProps {
	url: string;
}

export function VerifyEmail({ url }: VerifyEmailProps) {
	return (
		<AuthEmailLayout
			preview={`Verify your email for ${appName}`}
			heading="Verify your email"
			intro={`Thanks for signing up for ${appName}. Verify your email address to continue.`}
			details="This confirms the address belongs to you, which keeps your account secure."
			actionLabel="Verify email"
			actionUrl={url}
			outro="If you did not create this account, you can safely ignore this email."
		/>
	);
}

interface VerifyEmailChangeProps {
	url: string;
	previousEmail: string;
	newEmail: string;
}

export function VerifyEmailChange({ url, previousEmail, newEmail }: VerifyEmailChangeProps) {
	return (
		<AuthEmailLayout
			preview={`Approve changing your ${appName} email address`}
			heading="Approve email change"
			intro={`Someone asked to change your ${appName} email from ${previousEmail} to ${newEmail}.`}
			details={`If you approve, we'll send a link to ${newEmail} to finish the change.`}
			actionLabel="Approve change"
			actionUrl={url}
			outro="If you did not request this change, ignore this email and change your password. The address on the account will not change without your approval."
		/>
	);
}
