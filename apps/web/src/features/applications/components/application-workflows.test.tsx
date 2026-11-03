// @vitest-environment happy-dom
import type { Application } from "../types";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	bulkDelete: vi.fn(),
	bulkUpdate: vi.fn(),
	parsePosting: vi.fn(),
	readPostingFile: vi.fn(),
	masterProfile: vi.fn(async () => ({ entries: [], standalone: [] }) as { entries: unknown[]; standalone: unknown[] }),
	create: vi.fn(),
	moveTo: vi.fn(),
	close: vi.fn(),
	remove: vi.fn(),
	invalidate: vi.fn(),
	confirm: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { ai: { parsePosting: api.parsePosting } } },
	orpc: {
		applications: {
			lanes: {
				get: {
					queryOptions: () => ({ queryKey: ["lanes"], queryFn: () => new Promise(() => {}) }),
					queryKey: () => ["lanes"],
				},
			},
			priorNoResponse: { queryOptions: () => ({ queryKey: ["prior"], queryFn: async () => [] }) },
			bulkDelete: { mutationOptions: () => ({ mutationFn: api.bulkDelete }) },
			bulkUpdate: { mutationOptions: () => ({ mutationFn: api.bulkUpdate }) },
			create: { mutationOptions: () => ({ mutationFn: api.create }) },
			ai: {
				parsePosting: { mutationOptions: () => ({ mutationFn: api.parsePosting }) },
				searchPostings: { mutationOptions: () => ({ mutationFn: async () => [] }) },
				readPostingFile: { mutationOptions: () => ({ mutationFn: api.readPostingFile }) },
			},
		},
		masterProfile: {
			get: { queryOptions: () => ({ queryKey: ["master-profile"], queryFn: api.masterProfile }) },
		},
		webAccess: {
			status: { queryOptions: () => ({ queryKey: ["web-access"], queryFn: async () => ({ search: false }) }) },
		},
		documents: { list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => api.invalidate,
	useApplicationActions: () => ({ moveTo: api.moveTo, close: api.close, remove: { mutate: api.remove } }),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => api.confirm }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: true }),
}));
vi.mock("@/dialogs/store", () => ({ useDialogStore: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

import { AddApplicationDialog } from "./add-application-dialog";
import { ApplicationBoard } from "./board";
import { ApplicationList } from "./list-view";

const application = (id: string, status: Application["status"]): Application => ({
	id,
	company: id === "closed" ? "Closed Co" : "Open Co",
	role: "Engineer",
	status,
	closedReason: status === "closed" ? "not-selected" : null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
	sentCheckScore: null,
	requirements: [],
	location: null,
	salary: null,
	source: null,
	sourceUrl: null,
	notes: null,
	tags: [],
	contacts: [],
	activity: [],
	appliedAt: new Date(),
	createdAt: new Date(),
	updatedAt: new Date(),
	resumeId: null,
	jobDescription: null,
	postingSource: null,
	matchScore: null,
	aiMetadata: null,
	resumeFileUrl: null,
	resumeFileName: null,
	coverLetterUrl: null,
	coverLetterName: null,
	followUpAt: null,
	followUpNote: null,
});
const clients: QueryClient[] = [];
const mount = (children: ReactNode) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>
	);
	return render(children, { wrapper });
};
beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.confirm.mockResolvedValue(true);
	api.bulkDelete.mockResolvedValue({ deleted: 1 });
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});

it("removes hidden closed applications from bulk selection before deleting visible rows", async () => {
	const rows = [application("open", "saved"), application("closed", "closed")];
	const view = mount(<ApplicationList applications={rows} showClosed selectedId={null} onOpen={vi.fn()} />);
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Engineer at Open Co" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Engineer at Closed Co" }));
	expect(screen.getByText("2 selected")).toBeTruthy();
	view.rerender(<ApplicationList applications={rows} showClosed={false} selectedId={null} onOpen={vi.fn()} />);
	expect(screen.queryByRole("checkbox", { name: "Select Engineer at Closed Co" })).toBeNull();
	expect(screen.getByText("1 selected")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
	await waitFor(() => expect(api.bulkDelete.mock.calls[0]?.[0]).toEqual({ ids: ["open"] }));
});

it("offers one board-card open control and a separate options control without a dead draggable tab stop", async () => {
	const row = application("open", "saved");
	const onOpen = vi.fn();
	const view = mount(<ApplicationBoard applications={[row]} showClosed={false} onOpen={onOpen} />);
	const open = screen.getByRole("button", { name: "Engineer Open Co" });
	const options = screen.getByRole("button", { name: "Options for Engineer at Open Co" });
	expect(view.container.querySelector("button button, [role=button] button")).toBeNull();
	for (let parent = open.parentElement; parent && parent !== view.container; parent = parent.parentElement) {
		expect(parent.tabIndex).toBeLessThan(0);
	}
	fireEvent.click(open);
	expect(onOpen).toHaveBeenCalledExactlyOnceWith(row);
	fireEvent.click(options);
	await screen.findByRole("menu");
	expect(onOpen).toHaveBeenCalledTimes(1);
});

it.each(["ai", "page"])(
	"does not report successful %s extraction when role and company are blank",
	async (filledBy) => {
		api.parsePosting.mockResolvedValue({
			role: "",
			company: "",
			location: "",
			salary: "",
			requirements: [],
			jobDescription: "A general careers landing page",
			filledBy,
			postingSource: { method: "fetch", format: "text", truncated: false, completeness: "unknown" },
		});
		mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
		fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
			target: { value: "https://example.test/careers" },
		});
		await screen.findByText(/Some job details couldn't be read/);
		expect(screen.queryByText(/Found (the )?role,? (and )?company/)).toBeNull();
		expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("textbox", { name: "Saved description" }) as HTMLTextAreaElement).value).toBe(
			"A general careers landing page",
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "Engineer" } });
		fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Known Company" } });
		expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(false);
	},
);

it("reads a posting file and saves the job straight into building a resume from the profile", async () => {
	api.masterProfile.mockResolvedValueOnce({ entries: [{ id: "role" }], standalone: [] });
	api.readPostingFile.mockResolvedValueOnce({
		role: "Web Developer",
		company: "Contoso",
		location: "Peterborough, ON",
		salary: "",
		requirements: ["WordPress", "Accessibility"],
		jobDescription: "Web Developer at Contoso. WordPress and accessibility.",
		sourceUrl: null,
		postingSource: { method: "upload", format: "text", truncated: false, completeness: "unknown" },
		enrichmentWarning: null,
		filledBy: "ai",
	});
	api.create.mockResolvedValueOnce("new-application");
	const onAdded = vi.fn();
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={onAdded} />);
	await screen.findByRole("button", { name: "Upload PDF or Word file" });
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("No file input.");
	const file = new File(["%PDF"], "posting.pdf", { type: "application/pdf" });
	fireEvent.change(input, { target: { files: [file] } });
	await screen.findByText(/Found role, company and 2 requirements/);
	expect(screen.getByText("posting.pdf")).toBeTruthy();
	expect(screen.getByText("Uploaded and read")).toBeTruthy();
	expect(api.readPostingFile.mock.calls[0]?.[0]).toEqual({ file });
	expect((screen.getByRole("textbox", { name: "Role" }) as HTMLInputElement).value).toBe("Web Developer");
	fireEvent.click(await screen.findByRole("button", { name: "Save and build resume" }));
	await waitFor(() => expect(onAdded).toHaveBeenCalledWith("new-application", { assemble: true }));
	expect(api.create.mock.calls[0]?.[0]).toMatchObject({
		role: "Web Developer",
		company: "Contoso",
		jobDescription: "Web Developer at Contoso. WordPress and accessibility.",
		postingSource: { method: "upload" },
	});
});

it("says when a posting file couldn't be read, and lets it be removed", async () => {
	api.readPostingFile.mockRejectedValueOnce(new Error("unreadable"));
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	await screen.findByRole("button", { name: "Upload PDF or Word file" });
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("No file input.");
	fireEvent.change(input, { target: { files: [new File(["x"], "scan.pdf", { type: "application/pdf" })] } });
	await screen.findByText("Couldn't read");
	expect(screen.getByRole("alert").textContent).toContain("unreadable");
	fireEvent.click(screen.getByRole("button", { name: "Remove scan.pdf" }));
	expect(screen.queryByText("scan.pdf")).toBeNull();
});

it("fills the details by itself shortly after a posting is pasted, keeping what the user typed", async () => {
	api.parsePosting.mockResolvedValueOnce({
		role: "Communications Manager",
		company: "Harbourview Food Bank",
		location: "Peterborough, ON",
		salary: "$70,000",
		requirements: ["Writing"],
		jobDescription: "Communications Manager at Harbourview Food Bank, Peterborough.",
		sourceUrl: null,
		postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
		enrichmentWarning: null,
		filledBy: "ai",
	});
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Company" }), { target: { value: "My Company" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "Communications Manager at Harbourview Food Bank, Peterborough. $70,000." },
	});
	await waitFor(
		() =>
			expect((screen.getByRole("textbox", { name: "Role" }) as HTMLInputElement).value).toBe("Communications Manager"),
		{
			timeout: 3000,
		},
	);
	expect(api.parsePosting).toHaveBeenCalledTimes(1);
	expect((screen.getByRole("textbox", { name: "Company" }) as HTMLInputElement).value).toBe("My Company");
	expect((screen.getByRole("textbox", { name: "Location" }) as HTMLInputElement).value).toBe("Peterborough, ON");
	expect((screen.getByRole("textbox", { name: "Salary" }) as HTMLInputElement).value).toBe("$70,000");
	expect(screen.getByRole("button", { name: "Read again" })).toBeTruthy();
});
