/**
 * Concrete adapters that back runCodingDispatch's injected ports:
 *   - HTTP  → the host-authed Builderforce endpoints (Bearer agentHost API key)
 *   - Git   → the system `git` CLI, cloning/pushing through the HOST git-proxy
 *             with the agentHost key injected as an HTTP extra-header (the token
 *             itself stays server-side; we only send our OWN clk key)
 *   - Agent → the local gateway chat.send + the coding-session completion broker
 *
 * Kept separate from the pure orchestration so the latter stays unit-testable.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { awaitCodingSession } from "./coding-session-broker.js";
import type {
  CodingDispatchAgent,
  CodingDispatchGit,
  CodingDispatchHttp,
  DispatchDetail,
} from "./builderforce-coding-dispatch.js";

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
      const res = await fetch(`${hostBase}/dispatch/${encodeURIComponent(dispatchId)}/pull-request`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(pr),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { url?: string; number?: number };
      return typeof body.url === "string" && typeof body.number === "number"
        ? { url: body.url, number: body.number }
        : null;
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
    async clone(cloneUrl, dir, branch): Promise<void> {
      const args = [...authHeaderArgs, "clone", "--depth", "1", "--single-branch"];
      if (branch) args.push("--branch", branch);
      args.push(cloneUrl, dir);
      await run(args);
    },

    async checkoutNewBranch(dir, branch): Promise<void> {
      await run(["-C", dir, "checkout", "-b", branch]);
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
        return { ok: false, summary: `chat.send failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      const outcome = await done;
      return { ok: outcome.ok, summary: outcome.text };
    },
  };
}
