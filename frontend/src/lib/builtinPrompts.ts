import type { PromptPublicView } from './builderforceApi';

/**
 * Curated, built-in starter prompts for the public Prompt Library.
 *
 * The public gallery (GET /api/prompts/public) only returns tenant-published
 * rows, so a fresh install shows an empty page. Rather than seed tenant-owned
 * rows into the DB (every row needs a real tenant_id + segment, which pollutes a
 * tenant's "My prompts" and can't run against the live DB), we ship a curated
 * set in the repo and MERGE it into the gallery — the same pattern the Models
 * page uses for its built-in Builderforce records (see lib/modelCatalog).
 *
 * These are content, not data: they live in source, work in every environment
 * with zero DB dependency, and are copy-only (no usage/star persistence). Live
 * user-published public prompts merge on top and win on slug collision.
 */

const BUILTIN_AUTHOR = 'Builderforce';

/** A built-in prompt is a full public view plus a marker the UI keys off. */
export interface BuiltinPrompt extends PromptPublicView {
  builtin: true;
}

/** Synthetic id prefix so the page can tell a built-in from a DB row by id. */
export const BUILTIN_ID_PREFIX = 'builtin:';

export function isBuiltinId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(BUILTIN_ID_PREFIX);
}

/** Canonical category labels surfaced as the curated set. */
export const BUILTIN_CATEGORIES = [
  'Entrepreneurs',
  'Testing',
  'Coding',
  'Business Analysis',
  'Marketing Research',
] as const;

/** Build a BuiltinPrompt from a terse spec — keeps the list below readable. */
function prompt(spec: {
  slug: string;
  title: string;
  description: string;
  category: (typeof BUILTIN_CATEGORIES)[number];
  tags: string[];
  body: string;
  variables?: { name: string; description?: string }[];
  model?: string;
}): BuiltinPrompt {
  return {
    builtin: true,
    id: `${BUILTIN_ID_PREFIX}${spec.slug}`,
    slug: spec.slug,
    title: spec.title,
    description: spec.description,
    category: spec.category,
    tags: spec.tags,
    authorName: BUILTIN_AUTHOR,
    currentVersion: 1,
    usageCount: 0,
    starCount: 0,
    isFeatured: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    body: spec.body,
    variables: spec.variables ?? [],
    model: spec.model ?? null,
  };
}

export const BUILTIN_PROMPTS: BuiltinPrompt[] = [
  // ─────────────────────────── Entrepreneurs ────────────────────────────────
  prompt({
    slug: 'startup-idea-validation',
    title: 'Startup Idea Validator',
    description: 'Pressure-test a business idea across demand, moat, unit economics, and the riskiest assumption to test first.',
    category: 'Entrepreneurs',
    tags: ['startup', 'validation', 'strategy'],
    model: 'claude-opus-4-8',
    body: `You are a skeptical pre-seed venture partner. Evaluate the following startup idea and give me an honest, no-hype assessment.

Idea: {{idea}}
Target customer: {{customer}}
How it makes money: {{business_model}}

Produce:
1. Problem severity — is this a painkiller or a vitamin? (1-10, with reasoning)
2. Who exactly feels this pain most acutely, and how do they solve it today?
3. Top 3 reasons this could fail.
4. The single riskiest assumption, and the cheapest experiment to test it within 2 weeks.
5. A rough TAM/SAM/SOM sketch with the napkin math you used.
6. Verdict: pursue, reshape, or pass — and why.

Be direct. If the idea is weak, say so and explain what would have to be true for it to work.`,
    variables: [
      { name: 'idea', description: 'One-paragraph description of the idea' },
      { name: 'customer', description: 'Who you are building it for' },
      { name: 'business_model', description: 'How the business earns revenue' },
    ],
  }),
  prompt({
    slug: 'lean-business-model-canvas',
    title: 'Lean Business Model Canvas',
    description: 'Turn a one-line idea into a complete lean canvas: problem, solution, channels, revenue, costs, and unfair advantage.',
    category: 'Entrepreneurs',
    tags: ['startup', 'business-model', 'planning'],
    body: `Act as a startup advisor. Build a Lean Canvas for this venture.

Venture: {{venture}}
Stage: {{stage}}

Fill in every block with concrete, specific content (no placeholders):
- Problem (top 3) and existing alternatives
- Customer segments + early adopters
- Unique value proposition (single, clear sentence) + high-level concept
- Solution (top 3 features)
- Channels (paths to customers)
- Revenue streams + pricing model
- Cost structure (key costs)
- Key metrics (the 1-3 numbers that matter most now)
- Unfair advantage (what can't be easily copied or bought)

End with the 2 riskiest blocks to validate first and how.`,
    variables: [
      { name: 'venture', description: 'Short description of the business' },
      { name: 'stage', description: 'e.g. idea, pre-launch, early revenue' },
    ],
  }),
  prompt({
    slug: 'investor-cold-email',
    title: 'Investor Cold Outreach Email',
    description: 'Draft a crisp, high-signal cold email to an investor that earns a reply, with a follow-up sequence.',
    category: 'Entrepreneurs',
    tags: ['fundraising', 'email', 'outreach'],
    body: `Write a cold outreach email to an investor. It must be under 150 words, skimmable, and lead with traction or insight — not pleasantries.

Company: {{company}}
What we do (one line): {{one_liner}}
Traction / proof: {{traction}}
Round: {{round}}
Why this investor: {{why_them}}

Requirements:
- Subject line: 2 options, each under 6 words.
- Body: hook → what we do → proof → the ask → low-friction CTA.
- No buzzwords, no "I hope this finds you well", no attachments referenced.
Then add a 2-message follow-up sequence (send +4 days, +9 days) that adds new information each time rather than just "bumping".`,
    variables: [
      { name: 'company', description: 'Company name' },
      { name: 'one_liner', description: 'What you do in one sentence' },
      { name: 'traction', description: 'Revenue, users, growth, or notable proof' },
      { name: 'round', description: 'e.g. raising $750k pre-seed' },
      { name: 'why_them', description: 'Specific reason this investor fits' },
    ],
  }),

  // ───────────────────────────────── Testing ────────────────────────────────
  prompt({
    slug: 'test-plan-generator',
    title: 'Test Plan Generator',
    description: 'Generate a structured test plan for a feature: scope, scenarios, edge cases, data, and exit criteria.',
    category: 'Testing',
    tags: ['qa', 'test-plan', 'quality'],
    body: `You are a senior QA engineer. Produce a thorough test plan for the feature below.

Feature: {{feature}}
User-facing behavior / acceptance criteria: {{acceptance_criteria}}
Tech stack / constraints: {{stack}}

Deliver:
1. Scope — what is in and explicitly out of scope.
2. Test scenarios grouped by: happy path, edge cases, error handling, permissions/auth, performance, accessibility.
3. For each scenario: preconditions, steps, expected result, priority (P0-P2).
4. Test data needed (and any that must be mocked/seeded).
5. Risks and the areas most likely to break.
6. Exit criteria — what "done testing" means.

Format scenarios as a table.`,
    variables: [
      { name: 'feature', description: 'The feature under test' },
      { name: 'acceptance_criteria', description: 'How you know it works' },
      { name: 'stack', description: 'Languages, frameworks, environment' },
    ],
  }),
  prompt({
    slug: 'edge-case-finder',
    title: 'Edge-Case & Failure-Mode Finder',
    description: 'Given a function or feature, enumerate the boundary conditions and failure modes most teams miss.',
    category: 'Testing',
    tags: ['qa', 'edge-cases', 'robustness'],
    body: `Act as an adversarial tester whose goal is to break this code. Find the inputs and conditions that cause incorrect behavior.

Code or feature description:
{{code}}

Enumerate edge cases across these dimensions:
- Boundary values (0, empty, max, off-by-one, negative)
- Type/format surprises (null, undefined, NaN, unicode, very long strings)
- Concurrency / ordering / re-entrancy
- Resource limits (timeouts, large inputs, memory)
- Auth / permission boundaries
- External-dependency failures (network, DB, third-party errors)
- State the code assumes but never checks

For each, give: the input/condition, the likely failure, and a one-line assertion that would catch it. Rank by likelihood × impact.`,
    variables: [{ name: 'code', description: 'Paste the function, or describe the feature' }],
  }),
  prompt({
    slug: 'bug-repro-and-failing-test',
    title: 'Bug Report → Repro + Failing Test',
    description: 'Turn a vague bug report into clear repro steps, a root-cause hypothesis, and a failing test that proves it.',
    category: 'Testing',
    tags: ['qa', 'debugging', 'tests'],
    body: `You are a debugging specialist. Turn this bug report into something actionable.

Bug report: {{report}}
Expected behavior: {{expected}}
Environment: {{environment}}

Produce:
1. Clarified summary in one sentence.
2. Minimal, numbered reproduction steps.
3. 2-3 root-cause hypotheses, ranked, each with how to confirm/deny it.
4. A failing automated test (in {{framework}}) that reproduces the bug — it should fail now and pass once fixed.
5. The smallest likely fix, and any regression risks to check.`,
    variables: [
      { name: 'report', description: 'The raw bug report' },
      { name: 'expected', description: 'What should have happened' },
      { name: 'environment', description: 'OS, browser, version, etc.' },
      { name: 'framework', description: 'Test framework, e.g. Vitest, Jest, PyTest' },
    ],
  }),

  // ───────────────────────────────── Coding ─────────────────────────────────
  prompt({
    slug: 'thorough-code-review',
    title: 'Thorough Code Review',
    description: 'Review a diff or file for correctness bugs, security, performance, and clarity — ranked by severity.',
    category: 'Coding',
    tags: ['code-review', 'quality', 'security'],
    model: 'claude-opus-4-8',
    body: `You are a meticulous staff engineer reviewing a teammate's code. Be specific and actionable; cite line references.

Context / what it should do: {{context}}
Code:
{{code}}

Review across, in order of importance:
1. Correctness bugs and logic errors (highest priority).
2. Security issues (injection, authz, secrets, unsafe input).
3. Performance (N+1 queries, needless work, unbounded loops/results).
4. Error handling and edge cases.
5. Readability, naming, and duplication worth extracting.

For each finding: severity (critical/major/minor), the exact location, why it matters, and a concrete fix (show the corrected snippet). End with the top 3 things to fix before merge. Do not invent issues — if the code is solid, say so.`,
    variables: [
      { name: 'context', description: 'What the code is supposed to do' },
      { name: 'code', description: 'The diff or file to review' },
    ],
  }),
  prompt({
    slug: 'refactor-for-readability',
    title: 'Refactor for Readability',
    description: 'Rewrite code to be clearer and simpler without changing behavior, and explain each change.',
    category: 'Coding',
    tags: ['refactor', 'clean-code', 'maintainability'],
    body: `Refactor the following code for clarity and maintainability WITHOUT changing its observable behavior.

Code:
{{code}}

Constraints: {{constraints}}

Do this:
1. Return the refactored code.
2. Explain each meaningful change and the principle behind it (naming, single responsibility, early returns, removing duplication, etc.).
3. Call out anything you intentionally left alone and why.
4. Note any behavior you were unsure about so I can confirm before applying.

Prefer small, obvious improvements over clever rewrites. Match the existing style and idioms.`,
    variables: [
      { name: 'code', description: 'The code to refactor' },
      { name: 'constraints', description: 'e.g. keep the public API, target language version' },
    ],
  }),
  prompt({
    slug: 'explain-and-document-code',
    title: 'Explain & Document Code',
    description: 'Produce a plain-English explanation plus drop-in docstrings/comments for an unfamiliar piece of code.',
    category: 'Coding',
    tags: ['documentation', 'onboarding', 'comments'],
    body: `Explain this code so a new teammate could maintain it, then document it.

Code:
{{code}}

Deliver:
1. One-paragraph summary of what it does and why it exists.
2. A step-by-step walkthrough of the non-obvious parts.
3. Inputs, outputs, side effects, and failure modes.
4. Drop-in documentation: a docstring/JSDoc for each public function plus brief inline comments ONLY where the intent isn't obvious from the code.
5. Any bugs, smells, or risky assumptions you noticed while reading it.

Keep comments about "why", not "what". Don't restate the obvious.`,
    variables: [{ name: 'code', description: 'The code to explain and document' }],
  }),

  // ──────────────────────────── Business Analysis ───────────────────────────
  prompt({
    slug: 'requirements-to-user-stories',
    title: 'Requirements → User Stories',
    description: 'Convert a stakeholder request into well-formed user stories with acceptance criteria and edge cases.',
    category: 'Business Analysis',
    tags: ['requirements', 'user-stories', 'agile'],
    body: `You are a business analyst. Convert this stakeholder request into a clean backlog.

Request: {{request}}
Primary users / roles: {{roles}}
Known constraints: {{constraints}}

Produce:
1. A short problem statement and the business outcome it serves.
2. User stories in the form: "As a <role>, I want <goal>, so that <benefit>."
3. For each story: Gherkin-style acceptance criteria (Given/When/Then), priority (MoSCoW), and rough size (S/M/L).
4. Edge cases and non-functional requirements (security, performance, accessibility) the request implies but didn't state.
5. Open questions to send back to the stakeholder before work starts.`,
    variables: [
      { name: 'request', description: 'The raw stakeholder/feature request' },
      { name: 'roles', description: 'Who uses this' },
      { name: 'constraints', description: 'Budget, timeline, tech, compliance' },
    ],
  }),
  prompt({
    slug: 'process-improvement-analysis',
    title: 'Process Improvement Analysis',
    description: 'Map a current workflow, find bottlenecks and waste, and propose a prioritized improvement plan.',
    category: 'Business Analysis',
    tags: ['process', 'operations', 'efficiency'],
    body: `Act as an operations analyst. Analyze and improve this business process.

Process today (step by step): {{process}}
Goal / what "better" means here: {{goal}}
Constraints: {{constraints}}

Deliver:
1. A clean as-is process map (numbered steps with owners and handoffs).
2. Bottlenecks, rework loops, manual steps, and waiting time — where value is lost.
3. Root causes (use the "5 whys" on the biggest one).
4. A to-be process with the changes highlighted.
5. A prioritized action list scored by impact vs. effort, with the quick wins first.
6. Metrics to track to prove the improvement worked.`,
    variables: [
      { name: 'process', description: 'The current process, step by step' },
      { name: 'goal', description: 'Cost, speed, quality, or other target' },
      { name: 'constraints', description: 'What cannot change' },
    ],
  }),
  prompt({
    slug: 'question-to-sql',
    title: 'Plain English → SQL',
    description: 'Translate a business question into a correct, readable SQL query against your schema, with assumptions stated.',
    category: 'Business Analysis',
    tags: ['sql', 'data', 'analytics'],
    body: `You are a data analyst. Write a SQL query that answers the business question below.

Database: {{dialect}}
Schema (tables and key columns):
{{schema}}

Question: {{question}}

Produce:
1. The SQL query, formatted and commented.
2. A one-line plain-English description of what it returns.
3. Any assumptions you made (date ranges, joins, de-duplication, null handling) — state them explicitly so I can correct them.
4. One alternative if the question could be interpreted another way.

Prefer clarity over cleverness. Avoid SELECT * and unbounded results.`,
    variables: [
      { name: 'dialect', description: 'e.g. PostgreSQL, MySQL, BigQuery' },
      { name: 'schema', description: 'Relevant tables and columns' },
      { name: 'question', description: 'The business question to answer' },
    ],
  }),

  // ─────────────────────────── Marketing Research ───────────────────────────
  prompt({
    slug: 'competitor-analysis',
    title: 'Competitor Analysis',
    description: 'Build a structured competitive landscape: positioning, pricing, strengths, gaps, and where you can win.',
    category: 'Marketing Research',
    tags: ['competitive-analysis', 'strategy', 'positioning'],
    body: `You are a market analyst. Produce a competitive analysis for the market below.

Our product: {{product}}
Target market: {{market}}
Known competitors: {{competitors}}

Deliver:
1. A comparison table across competitors: positioning, target segment, pricing model, key strengths, notable weaknesses.
2. The unmet needs / gaps in the market none of them serve well.
3. Where each competitor is vulnerable.
4. A recommended positioning angle for us, with the proof points it requires.
5. 3 messaging hooks we could test, each tied to a specific gap.

If you're inferring rather than certain, label it clearly as an assumption to verify.`,
    variables: [
      { name: 'product', description: 'What you sell' },
      { name: 'market', description: 'The market / category' },
      { name: 'competitors', description: 'Names of the main competitors' },
    ],
  }),
  prompt({
    slug: 'customer-persona-builder',
    title: 'Customer Persona Builder',
    description: 'Turn what you know about your audience into a vivid, decision-ready buyer persona.',
    category: 'Marketing Research',
    tags: ['personas', 'audience', 'segmentation'],
    body: `Act as a customer researcher. Build a detailed buyer persona from what I know.

Product: {{product}}
What I know about the audience: {{audience_notes}}

Produce a persona with:
- Name, role, and a one-line summary.
- Goals and what success looks like for them.
- Pains, frustrations, and the cost of not solving them.
- Buying triggers and objections (and how to counter each).
- Where they spend attention (channels, communities, influencers).
- The exact words they'd use to describe their problem (voice-of-customer phrases).
- How to message to them: what resonates vs. what to avoid.

Then list the 3 riskiest assumptions in this persona and how I could validate them with real customers.`,
    variables: [
      { name: 'product', description: 'What you sell' },
      { name: 'audience_notes', description: 'Anything you know about your customers' },
    ],
  }),
  prompt({
    slug: 'survey-design',
    title: 'Customer Survey Designer',
    description: 'Design an unbiased survey that produces decisions, not vanity data, with the right question types.',
    category: 'Marketing Research',
    tags: ['surveys', 'research', 'voice-of-customer'],
    body: `You are a research methodologist. Design a survey to answer my research goal.

Research goal / decision this informs: {{goal}}
Audience: {{audience}}
How it'll be sent: {{channel}}

Produce:
1. 8-12 questions ordered from easy to sensitive, mixing question types (multiple choice, Likert, open-ended) appropriately.
2. For each question, note what decision it informs.
3. Flag and rewrite any leading, double-barreled, or ambiguous phrasing.
4. Screening questions to filter out the wrong respondents.
5. Estimated completion time and tips to maximize response rate.
6. How you'd analyze the results once they're in.

Keep it short enough that people actually finish it.`,
    variables: [
      { name: 'goal', description: 'What you need to learn' },
      { name: 'audience', description: 'Who you are surveying' },
      { name: 'channel', description: 'e.g. email, in-app, social' },
    ],
  }),
];

/** Filter the built-in set by a free-text query and optional category. */
export function filterBuiltinPrompts(q?: string, category?: string): BuiltinPrompt[] {
  const needle = q?.trim().toLowerCase();
  return BUILTIN_PROMPTS.filter((p) => {
    if (category && p.category !== category) return false;
    if (!needle) return true;
    return (
      p.title.toLowerCase().includes(needle) ||
      (p.description ?? '').toLowerCase().includes(needle) ||
      (p.category ?? '').toLowerCase().includes(needle) ||
      p.tags.some((t) => t.toLowerCase().includes(needle))
    );
  });
}
