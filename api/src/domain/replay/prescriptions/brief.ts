/**
 * The ticket brief a prescription hands to a person or a coding agent (PRD 33
 * §5.1.4) — pure. One builder for Fix it and Ticket, so the agent and the person
 * read the same finding, prescription, change and acceptance.
 *
 *   preview  a hosted app with a coding agent: build it and publish a PREVIEW
 *            release — never live; a person publishes it from Insights (D13).
 *   pr       a repo is connected: open a pull request, do not merge.
 *   ticket   a person does it.
 *
 * `objection_pattern` adds the FAQ / talk-track proposal the sales team needs.
 */

export type BriefMode = 'preview' | 'pr' | 'ticket';

export interface BriefInput {
  prescriptionId: string;
  ruleId: string;
  params: Record<string, string | number>;
  pagePath: string | null;
  selector: string | null;
  label: string | null;
  prescription: string | null;
  change: unknown;
  acceptance: { metric: string; direction: 'up' | 'down'; minVisits: number } | null;
  siteLabel: string;
  mode: BriefMode;
}

const TITLE_MAX = 200;

function changeLine(change: unknown): string | null {
  if (!change || typeof change !== 'object') return null;
  const c = change as Record<string, unknown>;
  if (typeof c.description !== 'string' || !c.description.trim()) return null;
  const target = typeof c.target === 'string' && c.target ? ` (on \`${c.target}\`)` : '';
  return `${c.description.trim()}${target}`;
}

const MODE_STEPS: Readonly<Record<BriefMode, string>> = {
  preview: 'Make the change in this app, build it, and publish it as a PREVIEW release (publish with `preview` set and '
    + '`prescription` = the id below). Do NOT publish it live: a person reviews the preview and publishes it from Insights.',
  pr: 'Make the change on a branch of the connected repository and open a pull request. Do not merge it: a person reviews it.',
  ticket: 'Make the change, then ship it in the next release; Insights measures it on that release.',
};

export function buildPrescriptionBrief(input: BriefInput): { title: string; description: string } {
  const where = input.pagePath ? ` on ${input.pagePath}` : '';
  const what = input.label || input.selector || String(input.params.label ?? input.params.route ?? input.ruleId);
  const title = `Insights fix: ${input.ruleId.replace(/_/g, ' ')}${where}${what && what !== input.pagePath ? ` (${what})` : ''}`.slice(0, TITLE_MAX);
  const facts = Object.entries(input.params).map(([k, v]) => `- **${k}:** ${String(v)}`).join('\n');
  const lines = [
    `**Site:** ${input.siteLabel}`,
    '',
    '**Finding** (measured, deterministic):',
    facts || '- (no parameters)',
    input.selector ? `- **element:** \`${input.selector}\`${input.label ? ` "${input.label}"` : ''}` : '',
    '',
    input.prescription ? `**Prescription:** ${input.prescription}` : '',
    changeLine(input.change) ? `**Suggested change:** ${changeLine(input.change)}` : '',
    input.acceptance
      ? `**Done when:** \`${input.acceptance.metric}\` moves ${input.acceptance.direction} on the release that ships this, over at least ${input.acceptance.minVisits} visits.`
      : '',
    '',
    `**How:** ${MODE_STEPS[input.mode]}`,
  ];
  if (input.ruleId === 'objection_pattern') {
    lines.push(
      '',
      '**Sales proposal:** add an FAQ entry that answers this objection on the page where it comes up, and a one-line talk track '
      + 'the team uses when a prospect raises it. Draft both from the pattern above; do not invent claims about the product.',
    );
  }
  lines.push('', `Prescription id: ${input.prescriptionId}`);
  return { title, description: lines.filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n').trim() };
}
