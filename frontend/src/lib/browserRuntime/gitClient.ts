/**
 * BrowserGitClient — in-browser git over the server-side git-proxy.
 *
 * A browser agent clones / branches / commits / pushes WITHOUT ever holding a
 * repo token: isomorphic-git talks to `${apiBase}/api/git-proxy/:repoId/...`,
 * and the proxy injects the tenant credential server-side. The git operations
 * are abstracted behind {@link GitOps} + {@link FsLike} so the orchestration is
 * unit-testable with fakes; {@link createBrowserGitClient} wires the real
 * isomorphic-git + LightningFS.
 */

export interface GitOps {
  clone(args: {
    dir: string; url: string; ref?: string; singleBranch?: boolean; depth?: number;
    headers?: Record<string, string>;
  }): Promise<void>;
  branch(args: { dir: string; ref: string; checkout?: boolean }): Promise<void>;
  add(args: { dir: string; filepath: string }): Promise<void>;
  commit(args: { dir: string; message: string; author: { name: string; email: string } }): Promise<string>;
  push(args: { dir: string; url: string; ref: string; headers?: Record<string, string> }): Promise<{ ok: boolean }>;
}

export interface FsLike {
  promises: {
    writeFile(path: string, data: string): Promise<void>;
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  };
}

export interface FileChange {
  path: string;
  content: string;
}

export interface BrowserGitClientDeps {
  ops: GitOps;
  fs: FsLike;
  url: string;
  dir: string;
  headers?: Record<string, string>;
  author?: { name: string; email: string };
}

const DEFAULT_AUTHOR = { name: 'BuilderForce Agent', email: 'agent@builderforce.ai' };

export class BrowserGitClient {
  private readonly author: { name: string; email: string };
  constructor(private readonly deps: BrowserGitClientDeps) {
    this.author = deps.author ?? DEFAULT_AUTHOR;
  }

  /** Shallow, single-branch clone of `ref` (the base branch) through the proxy. */
  async clone(ref?: string): Promise<void> {
    await this.deps.ops.clone({
      dir: this.deps.dir,
      url: this.deps.url,
      ref,
      singleBranch: true,
      depth: 1,
      headers: this.deps.headers,
    });
  }

  /** Create + check out a working branch for the agent's changes. */
  async createBranch(name: string): Promise<void> {
    await this.deps.ops.branch({ dir: this.deps.dir, ref: name, checkout: true });
  }

  /** Write the agent's file changes into the working tree (creating dirs). */
  async writeFiles(files: readonly FileChange[]): Promise<void> {
    for (const f of files) {
      const slash = f.path.lastIndexOf('/');
      if (slash > 0) {
        await this.deps.fs.promises.mkdir(`${this.deps.dir}/${f.path.slice(0, slash)}`, { recursive: true });
      }
      await this.deps.fs.promises.writeFile(`${this.deps.dir}/${f.path}`, f.content);
    }
  }

  /** Stage everything and commit. Returns the commit sha. */
  async commitAll(message: string): Promise<string> {
    await this.deps.ops.add({ dir: this.deps.dir, filepath: '.' });
    return this.deps.ops.commit({ dir: this.deps.dir, message, author: this.author });
  }

  /** Push the branch back through the proxy (which injects the push token). */
  async push(ref: string): Promise<{ ok: boolean }> {
    return this.deps.ops.push({ dir: this.deps.dir, url: this.deps.url, ref, headers: this.deps.headers });
  }
}
