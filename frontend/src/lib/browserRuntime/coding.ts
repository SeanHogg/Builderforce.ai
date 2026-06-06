/**
 * runCodingDispatch — the in-browser coding flow for a `browser` dispatch whose
 * task targets a repo. The agent proposes file changes (via its own model), and
 * this orchestration clones the repo (through the git-proxy), branches, writes
 * the changes, optionally builds/tests them in a WebContainer, then commits and
 * pushes — so the agent actually edits code in the browser, not just reasons.
 *
 * A FAILED build does NOT push (no broken branches); the dispatch is reported
 * failed and the kanban routes to needs_attention. Pure orchestration over
 * injected deps (git client, model proposer, optional build) → unit-testable.
 */
import type { BrowserGitClient, FileChange } from './gitClient';

export interface RepoContext {
  repoId: string;
  defaultBranch: string | null;
}

export interface ProposedChanges {
  /** Working branch name for the agent's changes. */
  branch: string;
  commitMessage: string;
  files: FileChange[];
  /** Human-readable summary of what the agent did. */
  summary?: string;
}

export interface CodingDeps {
  git: BrowserGitClient;
  /** Ask the agent's model to propose concrete file edits for the task. */
  propose: (args: { role: string; input: string }) => Promise<ProposedChanges>;
  /** Optional WebContainer build/test gate; if it fails, we do NOT push. */
  build?: () => Promise<{ ok: boolean; output: string }>;
  /** Optional: open a PR server-side after a successful push. Returns null when
   *  the provider does not support automated PRs (branch is still pushed). */
  openPr?: (args: {
    branch: string;
    base?: string;
    title?: string;
    body?: string;
  }) => Promise<{ url: string; number: number } | null>;
}

export interface CodingResult {
  pushed: boolean;
  branch: string;
  commitSha?: string;
  buildOk?: boolean;
  /** Set when a PR was opened for the pushed branch. */
  prUrl?: string;
  prNumber?: number;
  summary: string;
}

/**
 * Parse the model's coding output into structured changes. The agent is asked
 * to return JSON `{ branch?, commitMessage?, files: [{path, content}], summary? }`
 * (optionally fenced). Throws on unusable output so the dispatch reports failed
 * rather than pushing nothing silently.
 */
export function parseProposedChanges(
  modelText: string,
  opts: { fallbackBranch: string },
): ProposedChanges {
  const fenced = modelText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : modelText).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Agent did not return valid JSON file changes.');
  }
  const obj = parsed as Record<string, unknown>;
  const filesIn = Array.isArray(obj.files) ? obj.files : [];
  const files: FileChange[] = filesIn
    .map((f) => f as Record<string, unknown>)
    .filter((f) => typeof f.path === 'string' && typeof f.content === 'string')
    .map((f) => ({ path: f.path as string, content: f.content as string }));

  return {
    branch: typeof obj.branch === 'string' && obj.branch.trim() ? obj.branch.trim() : opts.fallbackBranch,
    commitMessage:
      typeof obj.commitMessage === 'string' && obj.commitMessage.trim()
        ? obj.commitMessage.trim()
        : 'chore: agent changes',
    files,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
  };
}

export async function runCodingDispatch(
  dispatch: { role: string; input: string | null },
  repo: RepoContext,
  deps: CodingDeps,
): Promise<CodingResult> {
  const changes = await deps.propose({ role: dispatch.role, input: dispatch.input ?? '' });

  if (changes.files.length === 0) {
    return { pushed: false, branch: changes.branch, summary: changes.summary ?? 'No file changes proposed.' };
  }

  await deps.git.clone(repo.defaultBranch ?? undefined);
  await deps.git.createBranch(changes.branch);
  await deps.git.writeFiles(changes.files);

  // Optional build/test gate — never push broken code.
  let buildOk: boolean | undefined;
  if (deps.build) {
    const result = await deps.build();
    buildOk = result.ok;
    if (!result.ok) {
      return {
        pushed: false,
        branch: changes.branch,
        buildOk: false,
        summary: `Build/test failed; not pushed.\n${result.output}`.trim(),
      };
    }
  }

  const commitSha = await deps.git.commitAll(changes.commitMessage);
  await deps.git.push(changes.branch);

  // Open a PR for the pushed branch (server-side; token never reaches here).
  let pr: { url: string; number: number } | null = null;
  if (deps.openPr) {
    pr = await deps.openPr({
      branch: changes.branch,
      base: repo.defaultBranch ?? undefined,
      title: changes.commitMessage,
      body: changes.summary,
    });
  }

  const pushedSummary = changes.summary ?? `Pushed ${changes.files.length} file(s) to ${changes.branch}.`;
  const fileList = `Changed files:\n${changes.files.map((f) => `  - ${f.path}`).join('\n')}`;
  const base = `${pushedSummary}\n\n${fileList}`;
  return {
    pushed: true,
    branch: changes.branch,
    commitSha,
    buildOk,
    prUrl: pr?.url,
    prNumber: pr?.number,
    summary: pr ? `${base}\n\nOpened PR #${pr.number}: ${pr.url}` : base,
  };
}
