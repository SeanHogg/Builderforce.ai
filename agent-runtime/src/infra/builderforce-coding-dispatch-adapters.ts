/**
 * Concrete adapters that back runCodingDispatch's injected ports:
 *   - HTTP  → the host-authed Builderforce endpoints (Bearer agentHost API key)
 *   - Git   → the system `git` CLI, cloning/pushing through the HOST git-proxy
 *             with the agentHost key injected as an HTTP extra-header (the token
 *             itself stays server-side; we only send our OWN agent API key)
 *   - Agent → the local gateway chat.send + the coding-session completion broker
 *
 * Kept separate from the pure orchestration so the latter stays unit-testable.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import type {
  CodingDispatchAgent,
  CodingDispatchFs,
  CodingDispatchGit,
  CodingDispatchHttp,
  DispatchDetail,
  WorkspaceFile,
} from "./builderforce-coding-dispatch.js";
import { awaitCodingSession } from "./coding-session-broker.js";

const execFileAsync = promisify(execFile);

interface GatewayLike {
  request<T = Record<string, unknown>>(method: string, params?: unknown): Promise<T>;
}

export function makeCodingHttp(opts: {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
}): CodingDispatchHttp {
  const base = normalizeBaseUrl(opts.baseUrl);
  const auth = { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" };
  const hostBase = `${base}/api/agent-hosts/${opts.agentNodeId}`;

  return {
    async fetchDispatchDetail(dispatchId: string): Promise<DispatchDetail | null> {
      const res = await fetch(`${hostBase}/dispatch/${encodeURIComponent(dispatchId)}`, {
        headers: { Authorization: auth.Authorization },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { dispatch?: DispatchDetail | null };
      return body.dispatch ?? null;
    },

    async openPullRequest(dispatchId, pr): Promise<{ url: string; number: number } | null> {
      const res = await fetch(
        `${hostBase}/dispatch/${encodeURIComponent(dispatchId)}/pull-request`,
        {
          method: "POST",
          headers: auth,
          body: JSON.stringify(pr),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { url?: string; number?: number };
      return typeof body.url === "string" && typeof body.number === "number"
        ? { url: body.url, number: body.number }
        : null;
    },

    // Repo-less dispatch: the project's IDE workspace (R2) is the working tree.
    // Same auth boundary as the git-proxy above — the host key is all we send, and
    // the server does every bucket operation through its ONE workspace access layer.
    async fetchWorkspaceFiles(filesPath) {
      const res = await fetch(`${base}${filesPath}`, {
        headers: { Authorization: auth.Authorization },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { files?: WorkspaceFile[]; truncated?: boolean };
      return { files: body.files ?? [], truncated: body.truncated === true };
    },

    async pushWorkspaceChanges(filesPath, payload) {
      const res = await fetch(`${base}${filesPath}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        written?: number;
        deleted?: number;
        rejected?: Array<{ path: string; reason: string }>;
      };
      return {
        written: body.written ?? 0,
        deleted: body.deleted ?? 0,
        rejected: body.rejected ?? [],
      };
    },

    async reportResult(dispatchId, result): Promise<void> {
      await fetch(`${hostBase}/dispatch-result`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ dispatchId, ...result }),
        signal: AbortSignal.timeout(15_000),
      });
    },
  };
}

export function makeCodingGit(opts: { apiKey: string }): CodingDispatchGit {
  // The agentHost key is sent as an HTTP extra-header so git authenticates to the
  // host git-proxy; the real provider token never reaches this process.
  const authHeaderArgs = ["-c", `http.extraHeader=Authorization: Bearer ${opts.apiKey}`];
  const identityArgs = [
    "-c",
    "user.email=agent@builderforce.ai",
    "-c",
    "user.name=BuilderForce Agent",
  ];

  const run = async (args: string[], cwd?: string): Promise<string> => {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    return stdout;
  };

  return {
    async hasClone(dir): Promise<boolean> {
      try {
        await run(["-C", dir, "rev-parse", "--is-inside-work-tree"]);
        return true;
      } catch {
        return false;
      }
    },

    async isDirty(dir): Promise<boolean> {
      const status = await run(["-C", dir, "status", "--porcelain"]);
      return status.trim().length > 0;
    },

    async clone(cloneUrl, dir, branch): Promise<void> {
      const args = [...authHeaderArgs, "clone", "--depth", "1", "--single-branch"];
      if (branch) args.push("--branch", branch);
      args.push(cloneUrl, dir);
      await run(args);
    },

    async syncToLatest(dir, branch): Promise<void> {
      // Pull the latest tip of the upstream branch and hard-reset onto it. The
      // caller only invokes this when the work tree is clean, so discarding local
      // state here is safe; `clean -fd` removes any stray untracked files.
      const ref = branch && branch.trim() ? branch : "HEAD";
      await run(["-C", dir, ...authHeaderArgs, "fetch", "--depth", "1", "origin", ref]);
      await run(["-C", dir, "reset", "--hard", "FETCH_HEAD"]);
      await run(["-C", dir, "clean", "-fd"]);
    },

    async checkoutNewBranch(dir, branch): Promise<void> {
      await run(["-C", dir, "checkout", "-b", branch]);
    },

    async checkoutOrCreateBranch(dir, branch): Promise<void> {
      try {
        await run(["-C", dir, "checkout", branch]);
      } catch {
        await run(["-C", dir, "checkout", "-b", branch]);
      }
    },

    async commitAll(dir, message): Promise<{ changed: boolean }> {
      await run(["-C", dir, "add", "-A"]);
      const status = await run(["-C", dir, "status", "--porcelain"]);
      if (!status.trim()) return { changed: false };
      await run(["-C", dir, ...identityArgs, "commit", "-m", message]);
      return { changed: true };
    },

    async push(dir, cloneUrl, branch): Promise<void> {
      await run(["-C", dir, ...authHeaderArgs, "push", cloneUrl, `HEAD:${branch}`]);
    },
  };
}

export function makeCodingAgent(getGateway: () => GatewayLike | null): CodingDispatchAgent {
  return {
    async run(sessionKey, message): Promise<{ ok: boolean; summary: string }> {
      const gw = getGateway();
      if (!gw) return { ok: false, summary: "local gateway not connected" };
      // Register the completion wait BEFORE sending so the terminal event can't race us.
      const done = awaitCodingSession(sessionKey);
      try {
        await gw.request("chat.send", {
          sessionKey,
          message,
          idempotencyKey: `coding-${sessionKey}`,
        });
      } catch (err) {
        return {
          ok: false,
          summary: `chat.send failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const outcome = await done;
      return { ok: outcome.ok, summary: outcome.text };
    },
  };
}


/**
 * Local-disk port for the workspace path. Everything the agent sees is a normal
 * directory tree, so the agent (and its tools) need no notion of R2 — the diff on
 * the way out is what turns "files on disk" back into a workspace change set.
 *
 * Directories that can never be project SOURCE are skipped on the way out
 * (`node_modules`, `.git`, build output, caches): an agent that runs an install
 * would otherwise try to upload tens of thousands of dependency files back into
 * the workspace. Binary/oversized files are skipped for the same reason the
 * server caps the tree it hands out — they are not editable text.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".cache",
  ".turbo",
  "coverage",
  ".venv",
  "__pycache__",
]);

/** Above this a file is treated as an asset, not source, and is not sent back. */
const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024;

export function makeCodingFs(): CodingDispatchFs {
  return {
    async materialize(dir, files): Promise<void> {
      await mkdir(dir, { recursive: true });
      for (const file of files) {
        const target = join(dir, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content, "utf8");
      }
    },

    async snapshot(dir): Promise<WorkspaceFile[]> {
      const out: WorkspaceFile[] = [];
      const walk = async (current: string): Promise<void> => {
        const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            await walk(join(current, entry.name));
            continue;
          }
          if (!entry.isFile()) continue;
          const full = join(current, entry.name);
          const buf = await readFile(full).catch(() => null);
          if (!buf || buf.byteLength > MAX_SNAPSHOT_FILE_BYTES) continue;
          // A NUL byte is the cheap, reliable "this is not text" signal; the
          // workspace stores text, so a binary would round-trip corrupted.
          if (buf.includes(0)) continue;
          // Workspace paths are always forward-slashed, on every platform.
          out.push({ path: relative(dir, full).split(sep).join("/"), content: buf.toString("utf8") });
        }
      };
      await walk(dir);
      return out;
    },
  };
}
