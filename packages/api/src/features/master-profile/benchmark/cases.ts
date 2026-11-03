import type { MasterProfile } from "../service";
import type { JobAnalysis } from "@reactive-resume/schema/resume-selection";
import { communicationsJob, consultantProfile, projectManagementJob, webDevJob } from "../selection/fixtures";

/**
 * Benchmark cases: one fictional candidate with a broad record, and postings from different job families. Each
 * case says which achievements and skills a good resume for it would use (the gold labels), so a run can be scored
 * on relevance and coverage, not only on whether it passed its own checks.
 */
export type BenchmarkCase = {
	id: string;
	family: string;
	profile: () => MasterProfile;
	/** The posting text, for runs that analyse it with a model. */
	posting: string;
	/** A reference analysis, for runs that skip the extraction step. */
	analysis: () => JobAnalysis;
	/** Achievements a strong resume for this posting uses. */
	relevant: string[];
	/** Achievements that would be off-target for this posting. */
	offTarget: string[];
	/** Skills the posting needs that the record has. */
	skills: string[];
	targetPages: number;
};

export const BENCHMARK_CASES: BenchmarkCase[] = [
	{
		id: "communications-manager",
		family: "Communications",
		profile: consultantProfile,
		posting: `Communications Manager, Harbourview Food Bank (fictional). You will plan and run multi-channel communications campaigns across email, social media and print; write newsletters, donor appeals, press releases and our annual report; support fundraising with donor communications; build media relations; and work with partners and volunteers. Requirements: 5+ years of communications experience, ideally in the nonprofit or charitable sector; excellent writing and storytelling; experience with email marketing and social media; media relations an asset.`,
		analysis: communicationsJob,
		relevant: ["a-campaign", "a-newsletter", "a-annual", "a-media", "a-social"],
		offTarget: ["a-retail-1", "a-retail-2", "a-scraper", "a-plugin"],
		skills: ["s-copy", "s-social", "s-media", "s-email"],
		targetPages: 2,
	},
	{
		id: "web-developer",
		family: "Web development",
		profile: consultantProfile,
		posting: `Web Developer, Civic Tech Co-op (fictional). Build and maintain websites and web applications for community clients. Must have: strong JavaScript, React and TypeScript; WordPress and PHP development, including custom plugins. Nice to have: REST API integrations and data pipelines (Node.js, databases); web accessibility (WCAG); comfort working with non-technical clients.`,
		analysis: webDevJob,
		relevant: ["a-portal", "a-plugin", "a-a11y", "a-civic", "a-scraper"],
		offTarget: ["a-retail-1", "a-retail-2", "a-annual", "a-media", "a-social"],
		skills: ["s-wp", "s-php", "s-js", "s-react", "s-ts", "s-a11y"],
		targetPages: 2,
	},
	{
		id: "project-manager",
		family: "Project management",
		profile: consultantProfile,
		posting: `Project Manager, Provincial Association of Planners (fictional). Deliver projects on time and on budget; coordinate vendors, staff and volunteers; manage stakeholders including our board and members; deliver our annual conference; report on scope and results. PMP or equivalent project management certification preferred.`,
		analysis: projectManagementJob,
		relevant: ["a-conference", "a-discovery", "a-events", "a-portal"],
		offTarget: ["a-retail-1", "a-retail-2", "a-scraper", "a-social"],
		skills: ["s-pm", "s-stake"],
		targetPages: 2,
	},
];
