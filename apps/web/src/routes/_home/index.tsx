import { createFileRoute, redirect } from "@tanstack/react-router";
import { Homepage } from "@/features/homepage/page";
import { getHomepageMeta } from "@/libs/seo";

// An instance's root resume (`ROOT_RESUME_ID`) is served by the server as a web page. Otherwise the root opens the
// app: the dashboard when signed in, the login page when not (the server redirects first-loads the same way). The
// marketing homepage is kept but not shown.
export const Route = createFileRoute("/_home/")({
	beforeLoad: ({ context }) => {
		throw redirect({ to: context.session ? "/dashboard" : "/auth/login", replace: true });
	},
	component: Homepage,
	head: () => {
		const { title, description } = getHomepageMeta();
		return { meta: [{ title }, { name: "description", content: description }] };
	},
});
