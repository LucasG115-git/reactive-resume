/**
 * The story file format, and instructions for an AI assistant (Claude, ChatGPT, …) to draft STARR stories with
 * the user from their own facts. English on purpose: it's addressed to the assistant, and keys must stay as is.
 */

export const STORY_FILE_TEMPLATE = `version: 1
stories:
  - title: Automating chapter membership checks
    tags: [automation, associations, data]
    situation: >-
      The chapter's volunteers checked member status by hand before applying event discounts,
      because member data lived in a separate national system.
    task: >-
      Give the website reliable, daily member status without a direct API to that system.
    action: >-
      I mapped the daily emailed export, built a mailhook that parsed the attachment into
      Google Sheets, and scheduled WP All Import to update WordPress. I tested edge cases
      with the chapter's staff before switching it on.
    result: >-
      Member discounts now apply automatically, removing the manual checks.
    reflection: >-
      I'd ask for API access earlier; the export route works but adds a moving part.
    facts: [F-1a2b3c4d, F-5e6f7a8b]
`;

type CatalogFact = { ref: string; category: string; text: string };

export function buildStoryPrompt(catalog: CatalogFact[]) {
	const facts = catalog.map((fact) => `${fact.ref} [${fact.category}] ${fact.text}`).join("\n");
	return `You're helping me prepare interview stories. Each one is a STARR story: Situation, Task, Action, Result, Reflection. A career tool will import them, link each to the facts that support it, and use them for interview preparation and practice. Take your time; specific, honest stories matter more than many.

MY FACTS
Below are my recorded career facts, each with a short id. They're the only verified record of my work.

${facts}

HOW TO WORK
1. Propose the 8–12 strongest story candidates from my facts. Cover different roles and different strengths (leadership, technical problem-solving, stakeholder management, handling setbacks, initiative, results). Briefly say why each is a good candidate, then let me add, drop or swap.
2. For each chosen story, interview me a few questions at a time:
   - Situation: what was happening, for whom, and why it mattered.
   - Task: what I specifically was responsible for.
   - Action: what I personally did, step by step. Say "I", not "we", unless the team's part matters.
   - Result: what changed, and how we know. Measured results only if I confirm the numbers.
   - Reflection: what I learned or would do differently.
   Push for specifics, but never fill gaps yourself.
3. Write each story in first person, plainly, in a way I could say aloud. Situation and Task: 1–3 sentences each. Action: 3–6 sentences. Result and Reflection: 1–3 sentences each.

RULES
- Never invent anything: no numbers, names, dates, tools or outcomes I haven't confirmed or that aren't in my facts.
- If I can't support a result, leave "result" empty rather than guessing. Reflection can also be empty.
- For "facts", list the ids of the facts above that back the story's claims (usually 1–5). Use only ids from the list, copied exactly.
- Give each story a short, recognizable title, unique across the file.

OUTPUT
When we're done, output ONLY YAML in one code block (and as a downloadable stories.yaml file if you can), using exactly these keys. Top level: version, stories. Story keys: title, tags, situation, task, action, result, reflection, facts.

\`\`\`yaml
${STORY_FILE_TEMPLATE}\`\`\`

Start with step 1.`;
}
