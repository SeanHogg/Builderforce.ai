/**
 * Pure builders for the message a claw executes to open a pull request.
 *
 * No IO: callers supply the resolved repo, the task, and (optionally) the PRD /
 * spec reference. The resulting {type:'create_pr', ...} envelope is what gets
 * POSTed to the CLAW_RELAY durable object's /dispatch endpoint.
 */

export type PrDispatchRepo = {
  provider: string;
  host: string;
  owner: string;
  repo: string;
  defaultBranch?: string | null;
};

export type PrDispatchTask = {
  id: number | string;
  title: string;
  description?: string | null;
  /** External board ticket reference (e.g. JIRA-123), if any. */
  ticketRef?: string | null;
  /** Optional caller-provided branch name; otherwise derived from the title. */
  branchName?: string | null;
};

export type PrDispatchPrd = {
  specId?: string | null;
  body?: string | null;
};

export type CreatePrMessage = {
  type: 'create_pr';
  repo: {
    provider: string;
    host: string;
    owner: string;
    repo: string;
    defaultBranch: string;
  };
  branchName: string;
  base: string;
  title: string;
  body: string;
  ticketRef: string | null;
  specId: string | null;
};

const DEFAULT_BASE_BRANCH = 'main';

/**
 * Slugify an arbitrary string into a git-branch-safe segment:
 *   - lower-cased
 *   - non-alphanumerics collapsed to single hyphens
 *   - no leading/trailing hyphens
 *   - capped length
 */
export function slugifyBranchSegment(input: string, maxLength = 48): string {
  const slug = (input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return '';
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * Build a deterministic branch name for a task, e.g. `task/42-add-login-flow`.
 * Honors an explicit task.branchName when provided (still slugified for safety).
 */
export function buildBranchName(task: PrDispatchTask): string {
  if (task.branchName?.trim()) {
    const explicit = slugifyBranchSegment(task.branchName, 80);
    if (explicit) return explicit;
  }

  const ref = task.ticketRef?.trim();
  const titleSlug = slugifyBranchSegment(task.title);
  const idPart = String(task.id).trim();

  if (ref) {
    const refSlug = slugifyBranchSegment(ref, 32);
    return titleSlug ? `task/${refSlug}-${titleSlug}` : `task/${refSlug}`;
  }
  if (idPart) {
    return titleSlug ? `task/${idPart}-${titleSlug}` : `task/${idPart}`;
  }
  return titleSlug ? `task/${titleSlug}` : 'task/change';
}

/** Build the PR body, combining the PRD body with a traceability footer. */
export function buildPrBody(task: PrDispatchTask, prd?: PrDispatchPrd): string {
  const lines: string[] = [];
  const prdBody = prd?.body?.trim();
  if (prdBody) {
    lines.push(prdBody);
    lines.push('');
  } else if (task.description?.trim()) {
    lines.push(task.description.trim());
    lines.push('');
  }

  lines.push('---');
  lines.push(`Task: #${task.id} — ${task.title}`);
  if (task.ticketRef?.trim()) lines.push(`Ticket: ${task.ticketRef.trim()}`);
  if (prd?.specId?.trim()) lines.push(`Spec: ${prd.specId.trim()}`);

  return lines.join('\n');
}

/**
 * Assemble the full create_pr message for a claw. PURE.
 */
export function buildPrDispatchMessage(
  repo: PrDispatchRepo,
  task: PrDispatchTask,
  prd?: PrDispatchPrd,
): CreatePrMessage {
  const base = repo.defaultBranch?.trim() || DEFAULT_BASE_BRANCH;
  return {
    type: 'create_pr',
    repo: {
      provider: repo.provider,
      host: repo.host,
      owner: repo.owner,
      repo: repo.repo,
      defaultBranch: base,
    },
    branchName: buildBranchName(task),
    base,
    title: task.title,
    body: buildPrBody(task, prd),
    ticketRef: task.ticketRef?.trim() || null,
    specId: prd?.specId?.trim() || null,
  };
}
