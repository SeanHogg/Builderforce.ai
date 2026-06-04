/**
 * factory.ts — wires the REAL in-browser coding stack: isomorphic-git over the
 * git-proxy (with LightningFS), a model-driven change proposer, and an optional
 * WebContainer build/test gate. This is thin glue around the unit-tested
 * orchestration in gitClient/coding/webcontainer; the live WebContainer boot is
 * capability-gated (it needs cross-origin isolation, so only a real tab runs it).
 */
import * as gitMod from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import { BrowserGitClient, type GitOps, type FsLike } from './gitClient';
import { runBuildInWebContainer, type WebContainerLike } from './webcontainer';
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

interface WalkFs {
  promises: {
    readdir(p: string): Promise<string[]>;
    stat(p: string): Promise<{ isDirectory(): boolean }>;
    readFile(p: string, enc: string): Promise<string>;
  };
}

/** Snapshot a LightningFS dir into a WebContainer FileSystemTree (skips .git). */
export async function snapshotDir(fs: WalkFs, dir: string): Promise<Record<string, unknown>> {
  const tree: Record<string, unknown> = {};
  const entries = await fs.promises.readdir(dir);
  for (const name of entries) {
    if (name === '.git') continue;
    const full = `${dir}/${name}`;
    const st = await fs.promises.stat(full);
    if (st.isDirectory()) {
      tree[name] = { directory: await snapshotDir(fs, full) };
    } else {
      tree[name] = { file: { contents: await fs.promises.readFile(full, 'utf8') } };
    }
  }
  return tree;
}

/** Boot a real WebContainer, gated on cross-origin isolation. */
export async function bootWebContainer(): Promise<WebContainerLike> {
  const g = globalThis as { crossOriginIsolated?: boolean };
  if ('crossOriginIsolated' in g && g.crossOriginIsolated === false) {
    throw new Error('WebContainer requires cross-origin isolation (COOP/COEP headers).');
  }
  const { WebContainer } = await import('@webcontainer/api');
  return (await WebContainer.boot()) as unknown as WebContainerLike;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}

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
  buildCommand?: string[];
}): CodingDeps {
  const { git, fs, dir } = createBrowserGitClient({
    repoId: opts.repo.repoId,
    apiBase: opts.apiBase,
    authHeaders: opts.authHeaders,
  });
  const model = (opts.dispatch.model ?? '').trim() || DEFAULT_BROWSER_MODEL;

  const propose: CodingDeps['propose'] = async ({ role, input }) => {
    const text = await opts.callModel({ model, prompt: codingPrompt(role, input) });
    return parseProposedChanges(text, { fallbackBranch: `agentHost/${slug(input)}` });
  };

  const build = opts.buildCommand
    ? async () => {
        const tree = await snapshotDir(fs as unknown as WalkFs, dir);
        return runBuildInWebContainer({ boot: bootWebContainer, tree }, opts.buildCommand as string[]);
      }
    : undefined;

  return { git, propose, build };
}
