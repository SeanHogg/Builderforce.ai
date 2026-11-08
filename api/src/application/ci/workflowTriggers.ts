/**
 * workflowTriggers — does a GitHub Actions workflow run on `pull_request` into a given base branch?
 *
 * A repo whose workflows trigger ONLY on a pull request reports no CI for a branch that has none
 * open, so a run without a shell can never get a build from the branch alone. This is the minimal
 * `on:` reader that tells those repos apart: no YAML dependency, just the three shapes GitHub
 * documents — a scalar (`on: pull_request`), a list (`on: [push, pull_request]` or a block list)
 * and a map (`on:\n  pull_request:\n    branches: [main]`). Never throws.
 *
 * The answer is "DEFINITELY fires": the `branches` / `branches-ignore` filters are checked against the
 * base branch the PR will target, and a `paths` / `paths-ignore` filter makes the answer "unknown" (the
 * workflow may not fire for this change), which reads as false — an early draft that no workflow answers
 * would only turn a verdict of `none` into `pending` and wait for a build that never comes.
 */

const PR_EVENT = /^(pull_request|pull_request_target)$/;

type Filters = Record<string, string[]>;

function stripComment(line: string): string {
  return line.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');
}

function unquote(token: string): string {
  return token.trim().replace(/^["']|["']$/g, '');
}

/** The top-level comma-separated entries of a flow list or map body. */
function splitTopLevel(inner: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let entry = '';
  for (const ch of inner) {
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { entries.push(entry); entry = ''; } else entry += ch;
  }
  entries.push(entry);
  return entries;
}

/** The entries of a flow list or flow map (or the scalar itself) as key + raw value: only their KEYS name events. */
function flowEntries(value: string): Array<{ key: string; value: string }> {
  const inner = /^[[{]/.test(value) ? value.slice(1).replace(/[\]}]\s*$/, '') : value;
  return splitTopLevel(inner).map((entry) => {
    const colon = entry.indexOf(':');
    return colon < 0 ? { key: unquote(entry), value: '' } : { key: unquote(entry.slice(0, colon)), value: entry.slice(colon + 1).trim() };
  });
}

/** The items of an inline value: a flow list `[a, b]` or one bare scalar. */
function listItems(value: string): string[] {
  const v = value.trim();
  const inner = v.startsWith('[') ? v.slice(1).replace(/\]\s*$/, '') : v;
  return splitTopLevel(inner).map(unquote).filter(Boolean);
}

/** The filters of an inline `{ branches: [main], paths: [a] }` map. */
function filtersFromFlow(value: string): Filters {
  if (!value.startsWith('{')) return {};
  const filters: Filters = {};
  for (const entry of flowEntries(value)) filters[entry.key] = listItems(entry.value);
  return filters;
}

/** The filters under a block-form event key (`branches:` followed by `- item` lines, or an inline list). */
function blockFilters(lines: string[], from: number, keyIndent: number): Filters {
  const filters: Filters = {};
  let childIndent = -1;
  let current: string | null = null;
  for (const line of lines.slice(from)) {
    if (!line.trim()) continue;
    const lead = line.length - line.trimStart().length;
    if (lead <= keyIndent) break;
    const text = line.trim();
    if (text.startsWith('-')) {
      if (current) (filters[current] ??= []).push(unquote(text.slice(1)));
      continue;
    }
    if (childIndent < 0) childIndent = lead;
    if (lead !== childIndent) continue;
    const match = /^([\w-]+)\s*:\s*(.*)$/.exec(text);
    if (!match) continue;
    current = match[1]!;
    filters[current] = listItems(match[2]!);
  }
  return filters;
}

/** The pull-request event's filters, or null when the workflow has no pull-request trigger at all. */
function pullRequestTriggerFilters(yaml: string): Filters | null {
  const lines = yaml.split(/\r?\n/).map(stripComment);
  const start = lines.findIndex((l) => /^["']?(on|true)["']?\s*:/.test(l));
  if (start < 0) return null;

  const inline = lines[start]!.replace(/^["']?(on|true)["']?\s*:/, '').trim();
  if (inline) {
    const entry = flowEntries(inline).find((e) => PR_EVENT.test(e.key));
    return entry ? filtersFromFlow(entry.value) : null;
  }

  // Block form: look only at the first indentation level under `on:`, so a nested
  // `pull_request` key (an input name, a path filter) is never mistaken for the event.
  const rest = lines.slice(start + 1);
  let indent = -1;
  for (let i = 0; i < rest.length; i++) {
    const line = rest[i]!;
    if (!line.trim()) continue;
    const lead = line.length - line.trimStart().length;
    // A block list may sit at column 0 (a `- push` line right under `on:`); any other column-0 line is the next top-level key.
    if (lead === 0 && !line.startsWith('-')) break;
    if (indent < 0) indent = lead;
    if (lead !== indent) continue;
    const body = line.trim().replace(/^-\s*/, '');
    const colon = body.indexOf(':');
    if (!PR_EVENT.test(unquote(colon < 0 ? body : body.slice(0, colon)))) continue;
    const after = colon < 0 ? '' : body.slice(colon + 1).trim();
    return after ? filtersFromFlow(after) : colon < 0 ? {} : blockFilters(rest, i + 1, lead);
  }
  return null;
}

/** A GitHub branch pattern (`*` stays inside a path segment, `**` crosses them, `?` is one character) as a RegExp. */
function branchPattern(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`);
}

/** Whether a `branches` list selects `branch`: patterns apply in order and a `!` pattern removes what an earlier one matched. */
function branchListMatches(patterns: string[], branch: string): boolean {
  let selected = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    if (branchPattern(negated ? pattern.slice(1) : pattern).test(branch)) selected = !negated;
  }
  return selected;
}

/** True when the workflow DEFINITELY runs for a pull request into `baseBranch` (no base given: the branch filters are not applied). */
export function workflowTriggersOnPullRequest(yaml: string, baseBranch?: string): boolean {
  const filters = pullRequestTriggerFilters(yaml);
  if (!filters) return false;
  // A path filter means the workflow may not fire for this change: unknown, which is not "will fire".
  if ('paths' in filters || 'paths-ignore' in filters) return false;
  if (baseBranch === undefined) return true;
  if (filters.branches && !branchListMatches(filters.branches, baseBranch)) return false;
  if (filters['branches-ignore'] && branchListMatches(filters['branches-ignore'], baseBranch)) return false;
  return true;
}
