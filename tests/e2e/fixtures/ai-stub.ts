import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";

/**
 * A scripted OpenAI-compatible provider for the assistant spec. It answers the connection test, and plays a small
 * conversation: read the document, propose an edit to its first passage, then say what changed. A message asking
 * for "a question" makes it ask one first; "slowly" streams a long reply that can be stopped.
 */

type ChatMessage = { role: string; content?: unknown; tool_call_id?: string; tool_calls?: unknown[] };
type ChatRequest = {
	model?: string;
	messages: ChatMessage[];
	tools?: Array<{ function: { name: string } }>;
	stream?: boolean;
};

/** A model name the stub doesn't know, for testing the fallback to the connection's own model. */
export const UNKNOWN_MODEL = "stub-unknown";

const text = (content: unknown) =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.map((part) => (part as { text?: string }).text ?? "").join("")
			: "";

function chunk(response: ServerResponse, delta: Record<string, unknown>, finish: string | null = null) {
	const body = {
		id: "chatcmpl-stub",
		object: "chat.completion.chunk",
		created: 0,
		model: "stub",
		choices: [{ index: 0, delta, finish_reason: finish }],
	};
	response.write(`data: ${JSON.stringify(body)}\n\n`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Fit check a workspace asks for: one requirement with no evidence yet, so the spec can add some. */
const FIT = {
	headline: "A relevant role, with one question to resolve",
	summary: "Each requirement from the posting, checked against your Knowledge.",
	requirements: [
		{
			text: "Enterprise onboarding",
			origin: "posting",
			status: "missing",
			evidence: "Your Knowledge doesn't say this yet.",
			factIds: [],
		},
	],
	checks: [],
	ask: null,
	factIds: [],
};

async function streamText(response: ServerResponse, words: string[], delayMs = 0) {
	chunk(response, { role: "assistant", content: "" });
	for (const word of words) {
		if (response.destroyed) return;
		chunk(response, { content: word });
		if (delayMs) await wait(delayMs);
	}
	chunk(response, {}, "stop");
	response.end("data: [DONE]\n\n");
}

function streamToolCall(response: ServerResponse, name: string, args: unknown) {
	chunk(response, {
		role: "assistant",
		content: null,
		tool_calls: [
			{
				index: 0,
				id: `call_${name}_${Date.now()}`,
				type: "function",
				function: { name, arguments: JSON.stringify(args) },
			},
		],
	});
	chunk(response, {}, "tool_calls");
	response.end("data: [DONE]\n\n");
}

function reply(request: ChatRequest, response: ServerResponse) {
	const messages = request.messages;
	const tools = new Set((request.tools ?? []).map((tool) => tool.function.name));
	const lastUser = [...messages].reverse().find((message) => message.role === "user");
	const said = text(lastUser?.content).toLowerCase();
	const sinceUser = messages.slice(messages.lastIndexOf(lastUser as ChatMessage) + 1);
	const lastTool = [...sinceUser].reverse().find((message) => message.role === "tool");
	const readTool = tools.has("read_letter") ? "read_letter" : "read_resume";

	response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });

	if (said.includes("slowly"))
		return streamText(
			response,
			Array.from({ length: 60 }, (_, index) => `word${index} `),
			150,
		);
	if (said.includes("review a story") && tools.has("save_story")) {
		if (lastTool) return streamText(response, ["Story decision received."]);
		const instructions = messages
			.filter((message) => message.role === "system")
			.map((message) => text(message.content))
			.join("\n");
		const factId = instructions.match(/"facts":\[\{"id":"([^"]+)"/)?.[1];
		return streamToolCall(response, "save_story", {
			title: "Improving customer onboarding",
			situation: "New customers needed clearer setup guidance.",
			task: "Make onboarding easier to follow.",
			action: "I wrote a setup checklist and reviewed it with support.",
			result: "",
			reflection: "Involve support early.",
			tags: ["onboarding"],
			factIds: factId ? [factId] : [],
		});
	}
	if (!tools.has("propose_edits")) return streamText(response, ["You ", "left ", "the ", "document ", "out."]);

	const asked = sinceUser.some((message) =>
		(message.tool_calls as Array<{ function?: { name?: string } }> | undefined)?.some(
			(call) => call.function?.name === "ask_user_question",
		),
	);
	if (said.includes("question") && !asked)
		return streamToolCall(response, "ask_user_question", {
			question: "The posting mentions accessibility. Have you done accessibility work?",
			choices: ["Yes, I have", "No, skip it"],
		});

	// The tool that produced the last result: read first, then propose, then say what changed.
	const calls = sinceUser.flatMap(
		(message) => (message.tool_calls as Array<{ id: string; function: { name: string } }> | undefined) ?? [],
	);
	const lastToolName = calls.find((call) => call.id === lastTool?.tool_call_id)?.function.name;
	if (!lastTool || lastToolName === "ask_user_question") return streamToolCall(response, readTool, {});

	let result: { data?: { passages?: Array<{ id: string; text: string }> } } = {};
	try {
		result = JSON.parse(text(lastTool.content) || "{}");
	} catch {
		// Not a read result.
	}
	const passage =
		lastToolName === readTool ? result.data?.passages?.find((item) => item.text && item.text !== "(empty)") : undefined;
	if (passage)
		return streamToolCall(response, "propose_edits", {
			title: "Tighten the first passage",
			edits: [
				{ passageId: passage.id, text: `${passage.text} (tightened by the stub)`, why: "Leads with the outcome." },
			],
		});

	return streamText(response, [
		"I ",
		"tightened ",
		"one ",
		"passage. ",
		"Accept ",
		"it ",
		"if ",
		"it ",
		"reads ",
		"right.",
	]);
}

function handle(request: IncomingMessage, response: ServerResponse, requests: ChatRequest[]) {
	let body = "";
	request.on("data", (data) => {
		body += data;
	});
	request.on("end", () => {
		if (!request.url?.endsWith("/chat/completions")) {
			response.writeHead(404).end();
			return;
		}
		const parsed = JSON.parse(body || "{}") as ChatRequest;
		requests.push(parsed);
		if (parsed.model === UNKNOWN_MODEL) {
			response.writeHead(404, { "content-type": "application/json" });
			response.end(
				JSON.stringify({ error: { message: `The model ${UNKNOWN_MODEL} does not exist`, code: "model_not_found" } }),
			);
			return;
		}
		const tailored = !parsed.stream ? tailoringAnswer(parsed) : null;
		if (tailored) {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					id: "chatcmpl-stub",
					object: "chat.completion",
					created: 0,
					model: parsed.model ?? "stub",
					choices: [
						{ index: 0, message: { role: "assistant", content: JSON.stringify(tailored) }, finish_reason: "stop" },
					],
					usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
				}),
			);
			return;
		}
		// A task model check: one JSON answer and one forced tool call.
		if (!parsed.stream && parsed.tools?.some((tool) => tool.function.name === "record_number")) {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					id: "chatcmpl-stub",
					object: "chat.completion",
					created: 0,
					model: parsed.model ?? "stub",
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: null,
								tool_calls: [
									{ id: "call-stub", type: "function", function: { name: "record_number", arguments: '{"value":7}' } },
								],
							},
							finish_reason: "tool_calls",
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
			return;
		}
		// The connection test asks for a single character, without streaming; a workspace tab asks for its JSON.
		if (!parsed.stream) {
			const asksForFit = parsed.messages.some((message) =>
				text(message.content).includes("Check the posting's requirements"),
			);
			const asksForCheck = parsed.messages.some((message) => text(message.content).includes('{"answer": 4}'));
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					id: "chatcmpl-stub",
					object: "chat.completion",
					created: 0,
					model: "stub",
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: asksForFit ? JSON.stringify(FIT) : asksForCheck ? '{"answer":4}' : "1",
							},
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
			return;
		}
		void reply(parsed, response);
	});
}

/** Rewrite the stub reviewer suggests for the first bullet: wording only, so it's applied. */
export const REVIEWER_PREFIX = "Reviewed: ";

/**
 * Answers for tailoring a resume: the posting analysis, no evidence review (the ranking decides), the writer
 * (each bullet as recorded), and a reviewer that rewords the first bullet. Null for anything else.
 */
function tailoringAnswer(request: ChatRequest): unknown {
	const system = request.messages
		.filter((message) => message.role === "system")
		.map((message) => text(message.content))
		.join("\n");
	const prompt = request.messages
		.filter((message) => message.role === "user")
		.map((message) => text(message.content))
		.join("\n");
	if (system.includes("You read job postings"))
		return {
			company: "Harbourview Food Bank",
			role: "Communications Manager",
			location: "Peterborough, ON",
			salary: "$68,000–$74,000",
			requirements: ["Nonprofit communications", "Email marketing"],
		};
	if (system.includes("You analyse job postings"))
		return {
			title: "Digital Project Manager",
			employer: "Lumen",
			seniority: "manager",
			requirements: [
				{ text: "WordPress development", importance: 5, necessity: "mandatory", kind: "skill", terms: ["WordPress"] },
				{
					text: "Nonprofit sector experience",
					importance: 4,
					necessity: "mandatory",
					kind: "domain",
					terms: ["nonprofits"],
				},
				{
					text: "Skilled in photography and videography",
					importance: 3,
					necessity: "preferred",
					kind: "skill",
					terms: [],
				},
				{
					text: "Plan Open House events for prospective students",
					importance: 3,
					necessity: "preferred",
					kind: "responsibility",
					terms: [],
				},
			],
		};
	if (system.includes("You review a candidate's verified career record")) return {};
	// A profile-gap draft: the user's note, reworded without adding anything.
	if (system.includes("You turn a candidate's own short account")) {
		const note = /<<<NOTE_START>>>\n([\s\S]*?)\n<<<NOTE_END>>>/.exec(prompt)?.[1]?.trim() ?? "";
		return { text: note.replace(/^I /, "").replace(/^\w/, (letter) => letter.toUpperCase()) };
	}
	if (system.includes("You write tailored resumes")) {
		const bullets = [...prompt.matchAll(/^\s+(A\d+): (.+?)(?: \[|$)/gm)].map(([, id, line]) => ({ id, text: line }));
		return { headline: "", summary: "", bullets, skillGroups: [] };
	}
	if (system.includes("You review a tailored resume draft")) {
		const first = /^\s+(B\d+): (.+)$/m.exec(prompt);
		return {
			score: 8,
			findings: first
				? [
						{
							category: "strength",
							severity: "medium",
							message: "Lead with the outcome.",
							ref: first[1],
							rewrite: `${REVIEWER_PREFIX}${first[2]}`,
							changesClaim: false,
						},
						{
							category: "relevance",
							severity: "low",
							message: "Mention the nonprofit focus earlier.",
							ref: null,
							rewrite: null,
							changesClaim: false,
						},
					]
				: [],
		};
	}
	return null;
}

export async function startAiStub(port = 0) {
	// Retain synthetic requests in memory so browser tests can inspect the actual provider boundary.
	const requests: ChatRequest[] = [];
	const server = createServer((request, response) => handle(request, response, requests));
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	const { port: bound } = server.address() as AddressInfo;
	return {
		baseURL: `http://127.0.0.1:${bound}/v1`,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
