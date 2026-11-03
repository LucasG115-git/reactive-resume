import { createFileRoute } from "@tanstack/react-router";
import { ResumeStyleSettings } from "@/features/settings/resume-style";

export const Route = createFileRoute("/dashboard/settings/resume-style")({
	component: ResumeStyleSettings,
});
