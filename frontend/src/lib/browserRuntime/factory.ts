/**
 * factory.ts — wires the REAL in-browser coding stack: isomorphic-git over the
 * git-proxy (with LightningFS) and a model-driven change proposer. Thin glue
 * around the unit-tested orchestration in gitClient/coding.
 */
import * as gitMod from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import { slugify } from '@builderforce/creation-canvas-contract';
import { BrowserGitClient, type GitOps, type FsLike } from './gitClient';
import { parseProposedChanges, type CodingDeps, type RepoContext } from './coding';
import { DEFAULT_BROWSER_MODEL, type ModelCall } from './runner';

/** Adapt isomorphic-git to our small GitOps port (binds fs + http). */
export function makeIsomorphicGitOps(fs: unknown): GitOps {
  return {
    clone: async (a) => {
      await gitMod.clone({ fs, http, ...a } as never);
    },
    branch: async (a) => {
      await gitMod.branch({ fs, ...a } as never);
    },
    add: async (a) => {
      await gitMod.add({ fs, ...a } as never);
    },
    commit: (a) => gitMod.commit({ fs, ...a } as never),
    push: async (a) => {
      await gitMod.push({ fs, http, ...a } as never);
      return { ok: true };
    },
  };
}

export function createBrowserGitClient(opts: {
  repoId: string;
  apiBase: string;
  authHeaders: Record<string, string>;
}): { git: BrowserGitClient; fs: FsLike; dir: string } {
  const fs = new LightningFS(`bf-${opts.repoId}-${crypto.randomUUID()}`);
  const ops = makeIsomorphicGitOps(fs);
  const dir = '/repo';
  const git = new BrowserGitClient({
    ops,
    fs: fs as unknown as FsLike,
    url: `${opts.apiBase.replace(/\/$/, '')}/api/git-proxy/${opts.repoId}`,
    dir,
    headers: opts.authHeaders,
  });
  return { git, fs: fs as unknown as FsLike, dir };
}

const slug = (text: string): string => slugify(text, { maxLength: 40, fallback: 'task' });

function codingPrompt(role: string, input: string): string {
  return [
    `You are the "${role}" coding agent. Implement the task below by editing the repository.`,
    'Return ONLY JSON of the form:',
    '{ "branch": "agentHost/<slug>", "commitMessage": "...", "summary": "...", "files": [ { "path": "relative/path", "content": "FULL new file contents" } ] }',
    'Include the COMPLETE contents of each file you change. Do not include explanations outside the JSON.',
    '',
    'TASK:',
    input || 'No task description provided.',
  ].join('\n');
}

/** Assemble the CodingDeps for a repo-targeted dispatch. */
export function createCodingDeps(opts: {
  dispatch: { role: string; input: string | null; model: string | null };
  repo: RepoContext;
  apiBase: string;
  authHeaders: Record<string, string>;
  callModel: (c: ModelCall) => Promise<string>;
  /** Opens a PR server-side for the pushed branch (the transport binds the
   *  dispatchId). Omitted → branch is pushed without a PR. */
  openPr?: CodingDeps['openPr'];
}): CodingDeps {
  const { git } = createBrowserGitClient({
    repoId: opts.repo.repoId,
    apiBase: opts.apiBase,
    authHeaders: opts.authHeaders,
  });
  const model = (opts.dispatch.model ?? '').trim() || DEFAULT_BROWSER_MODEL;

  const propose: CodingDeps['propose'] = async ({ role, input }) => {
    const text = await opts.callModel({ model, prompt: codingPrompt(role, input) });
    return parseProposedChanges(text, { fallbackBranch: `agentHost/${slug(input)}` });
  };

  return { git, propose, openPr: opts.openPr };
}
