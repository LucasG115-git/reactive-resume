/**
 * The profile file format, as a template and as instructions for an AI assistant (Claude, ChatGPT, …) that
 * writes one from a conversation or from documents. Kept in English: it's addressed to the assistant, and the
 * keys must stay as they are whatever the interface language.
 */

export const PROFILE_FILE_TEMPLATE = `version: 1

# Jobs. One entry per role; a promotion at the same employer is a new entry.
experience:
  - title: Founder & Principal
    organization: Example Studio
    location: Toronto, ON
    start: 2019-03          # YYYY or YYYY-MM
    end: present            # or YYYY / YYYY-MM
    summary: Web consultancy for nonprofits; team of 3.
    tags: [nonprofit, web]
    achievements:
      - Led discovery workshops with client boards to scope website rebuilds
      - text: Rebuilt a volunteer portal, cutting coordinator admin time by 40%
        metrics:
          - { value: 40, unit: "%", label: less admin time per month }
        skills: [WordPress, UX research]
        core: true          # always include when this job is on a resume

projects:
  - title: Civic dashboard
    start: 2025
    achievements:
      - Catalogued council votes into a searchable public site

education:
  - title: BBA, Entrepreneurship
    organization: Example University
    start: 2012
    end: 2016

volunteer: []
certifications: []
awards: []

# Skills, grouped by category.
skills:
  Web development: [WordPress, PHP, JavaScript]
  Project management: [Stakeholder management, Agile]
`;

export const PROFILE_FILE_PROMPT = `You're helping me build a structured record of my career, which a resume tool will import. Your job is to collect accurate facts and write them as a YAML file in the exact format below. Never invent anything.

How to work:
1. Start from whatever I give you: resumes, a LinkedIn export, bios, project notes, or what you already know about me from our conversations. Then interview me to fill gaps, one topic at a time: each role, notable projects, education, volunteering, certifications, awards and skills.
2. For every role, draw out 3–8 specific achievements: what I did, for whom, and what changed. Ask me for numbers (money, %, time saved, counts, team size, users), but only record a number if I confirm it. If I'm unsure, write the achievement without the number.
3. Write each achievement as a resume bullet: lead with a strong verb, one or two lines, past tense for past roles. Don't merge two achievements into one bullet.
4. Put the metric in both the bullet text and its "metrics" list. Add the skills or tools each achievement shows.
5. Mark "core: true" only on achievements I say should always appear.
6. Dates must be YYYY or YYYY-MM, or "present". If I don't know a month, use the year.
7. When we're done, output ONLY the YAML in one code block, using exactly these keys: version, experience, projects, education, volunteer, certifications, awards, skills. Entry keys: title, organization, location, url, start, end, summary, tags, achievements. Achievement keys: text, metrics (value, unit, label), skills, tags, variants, core. Skills map a category to a list of names.

Format:
\`\`\`yaml
${PROFILE_FILE_TEMPLATE}\`\`\`

Begin by asking what material I can share, then work through my history from most recent to oldest.`;
