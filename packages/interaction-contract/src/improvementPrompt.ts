/**
 * THE improvement prompt (PRD 33 §5.2 "Prompt"): the accepted fixes of a page as one
 * instruction a person pastes into the ONE composer, hands a coding agent, or
 * drops into any site builder's AI.
 *
 * Pure and deterministic — the same input always compiles to the same text — and
 * NEVER stored: the API compiles it on read. Fixed section order for every audience:
 *
 *   1. Page and goal
 *   2. Evidence (the measured numbers)
 *   3. Changes (each: element, before → after, reason)
 *   4. Constraints (brand palette and fonts, prices, legal copy, URL structure)
 *   5. Acceptance (and how Builderforce measures it)
 *
 * What the audience changes is how an element is named (a coding agent gets the
 * Playwright locator; a site builder gets the visible label first) and the one
 * line that says how to ship. Text is scrubbed: masked text is never carried
 * (`masked: true` drops the "before"), and anything shaped like a secret, an email
 * address or a token is replaced before it can reach a prompt.
 */

export type ImprovementAudience = 'composer' | 'coding_agent' | 'site_builder';

export const IMPROVEMENT_AUDIENCES: readonly ImprovementAudience[] = ['composer', 'coding_agent', 'site_builder'];

export interface ImprovementChange {
  /** The rect-map selector (a Playwright-style locator), or null for a page-level change. */
  selector: string | null;
  /** The element's visible label. */
  label?: string | null;
  before?: string | null;
  after?: string | null;
  reason: string;
  /** True when the element sits in a masked region: its text is never carried. */
  masked?: boolean;
}

export interface ImprovementPromptInput {
  page: { path: string; url?: string | null; siteLabel: string; goal?: string | null };
  evidence: Array<{ label: string; value: string | number }>;
  changes: ImprovementChange[];
  acceptance: Array<{ metric: string; direction: 'up' | 'down'; minVisits: number }>;
}

export const IMPROVEMENT_PROMPT_SECTIONS = ['Page and goal', 'Evidence', 'Changes', 'Constraints', 'Acceptance'] as const;

const FIELD_MAX = 400;
const CHANGES_MAX = 25;

const SECRET_SHAPES: readonly RegExp[] = [
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g,
  /\bbf[a-z]?_[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b[0-9a-f]{32,}\b/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];

/** Single-line, bounded, with anything secret-shaped replaced. */
export function scrubPromptText(raw: unknown, max: number = FIELD_MAX): string {
  let text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const shape of SECRET_SHAPES) text = text.replace(shape, '[redacted]');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const AUDIENCE_INTRO: Readonly<Record<ImprovementAudience, string>> = {
  composer: 'Improve this page of the app on the canvas. Make exactly the changes below and nothing else.',
  coding_agent: 'Improve one page of this site in its codebase. Make exactly the changes below and nothing else.',
  site_builder: 'Improve one page of my website. Make exactly the changes below and nothing else.',
};

const AUDIENCE_SHIP: Readonly<Record<ImprovementAudience, string>> = {
  composer: 'Apply the changes on the canvas and publish them as one release.',
  coding_agent: 'Ship the changes together as one release (one pull request); do not mix in unrelated work.',
  site_builder: 'Publish the changes together, in one update of the page.',
};

function elementName(change: ImprovementChange, audience: ImprovementAudience): string {
  const label = change.masked ? '' : scrubPromptText(change.label ?? '', 120);
  const selector = change.selector ? scrubPromptText(change.selector, 200) : '';
  if (!selector) return 'the page as a whole';
  if (audience === 'coding_agent') return `\`${selector}\`${label ? ` ("${label}")` : ''}`;
  if (audience === 'site_builder') return label ? `the element "${label}" (\`${selector}\`)` : `the element \`${selector}\``;
  return label ? `"${label}" (\`${selector}\`)` : `\`${selector}\``;
}

function changeLines(change: ImprovementChange, n: number, audience: ImprovementAudience): string[] {
  const lines = [`${n}. ${elementName(change, audience)}`];
  const before = change.masked ? '' : scrubPromptText(change.before ?? '');
  const after = scrubPromptText(change.after ?? '');
  if (change.masked) lines.push('   - Before: (masked on this page; not shown)');
  else if (before) lines.push(`   - Before: ${before}`);
  if (after) lines.push(`   - After: ${after}`);
  lines.push(`   - Why: ${scrubPromptText(change.reason) || 'see the evidence above'}`);
  return lines;
}

const humanMetric = (metric: string) => scrubPromptText(metric, 60).replace(/_/g, ' ');

/** Compile the prompt. Pure: the same input and audience give the same text. */
export function compileImprovementPrompt(input: ImprovementPromptInput, opts: { audience: ImprovementAudience }): string {
  const audience: ImprovementAudience = IMPROVEMENT_AUDIENCES.includes(opts.audience) ? opts.audience : 'composer';
  const path = scrubPromptText(input.page.path, 200) || '/';
  const url = input.page.url ? scrubPromptText(input.page.url, 300) : '';
  const goal = scrubPromptText(input.page.goal ?? '', 200);
  const changes = input.changes.slice(0, CHANGES_MAX);

  const out: string[] = [AUDIENCE_INTRO[audience], ''];

  out.push(`## ${IMPROVEMENT_PROMPT_SECTIONS[0]}`);
  out.push(`- Site: ${scrubPromptText(input.page.siteLabel, 120) || 'this site'}`);
  out.push(`- Page: ${path}${url ? ` (${url})` : ''}`);
  out.push(`- Goal: ${goal || 'more visitors take the page\'s next step'}`);
  out.push('');

  out.push(`## ${IMPROVEMENT_PROMPT_SECTIONS[1]}`);
  if (input.evidence.length === 0) out.push('- (no measured numbers yet)');
  for (const e of input.evidence) out.push(`- ${scrubPromptText(e.label, 120)}: ${scrubPromptText(e.value, 120)}`);
  out.push('');

  out.push(`## ${IMPROVEMENT_PROMPT_SECTIONS[2]}`);
  if (changes.length === 0) out.push('- (no changes accepted)');
  changes.forEach((change, i) => out.push(...changeLines(change, i + 1, audience)));
  out.push('');

  out.push(`## ${IMPROVEMENT_PROMPT_SECTIONS[3]}`);
  out.push('- Keep the brand palette and fonts exactly as they are; use only colours already on the page.');
  out.push('- Do not change prices, plans, legal copy, terms or privacy text.');
  out.push('- Keep the URL structure: do not rename, move or remove pages or links.');
  out.push('- Change only the elements listed above.');
  out.push('');

  out.push(`## ${IMPROVEMENT_PROMPT_SECTIONS[4]}`);
  if (input.acceptance.length === 0) out.push('- The page\'s conversion goes up.');
  for (const a of input.acceptance) {
    out.push(`- ${humanMetric(a.metric)} moves ${a.direction === 'down' ? 'down' : 'up'} over at least ${Math.max(0, Math.round(a.minVisits))} visits.`);
  }
  out.push('- How Builderforce measures it: Insights detects the release that ships these changes and compares this page on that release '
    + 'against the release before it, from every visit (not a sample); the verdict appears on each fix once the new release has enough visits.');
  out.push(`- ${AUDIENCE_SHIP[audience]}`);
  return out.join('\n');
}
