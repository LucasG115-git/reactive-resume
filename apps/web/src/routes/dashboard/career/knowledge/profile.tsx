import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/features/career/knowledge/profile";

export const Route = createFileRoute("/dashboard/career/knowledge/profile")({
	component: ProfilePage,
});
