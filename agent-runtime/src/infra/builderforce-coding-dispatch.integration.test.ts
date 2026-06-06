/**
 * End-to-end integration test for the headless coding dispatch.
 *
 * This drives the REAL runtime handler (runCodingDispatch) through the REAL
 * adapters (makeCodingHttp over `fetch`, makeCodingGit over the system `git`)
 * against:
 *   - a REAL local bare git repo standing in for the host git-proxy upstream
 *     (cloneUrl is a filesystem path, so the exact `git clone/commit/push` args
 *     the adapter emits are exercised for real), and
 *   - a fake HTTP server implementing the host dispatch-detail / pull-request /
 *     dispatch-result endpoints (standing in for the Builderforce API + DB).
 *
 * Only the LLM (the agent edit) and the DB (the HTTP server's in-memory store)
 * are faked. Everything else is the production code path, proving the headless
 * loop clones → edits → commits → pushes → opens-PR → reports end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCodingDispatch } from "./builderforce-coding-dispatch.js";
import { makeCodingHttp, makeCodingGit } from "./builderforce-coding-dispatch-adapters.js";
import type { CodingDispatchAgent } from "./builderforce-coding-dispatch.js";

const exec = promisify(execFile);
const git = (args: string[], cwd?: string) =>
  exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });

const AGENT_NODE_ID = "42";
const API_KEY = "clk_test_key";
const DISPATCH_ID = "disp-e2e-0001";

let tmpRoot: string;
let bareRepo: string;
let workspaceDir: string;
let server: http.Server;
let baseUrl: string;
const recorded: { pr?: unknown; result?: unknown } = {};

async function readBranchFileFromBare(branch: string, file: string): Promise<string> {
  // Verify the pushed branch actually contains the agent's change.
  const { stdout } = await git(["--git-dir", bareRepo, "show", `${branch}:${file}`]);
  return stdout;
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bf-e2e-"));
  bareRepo = path.join(tmpRoot, "upstream.git");
  workspaceDir = path.join(tmpRoot, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });

  // Seed a real upstream bare repo with one commit on `main`.
  await git(["init", "--bare", "-b", "main", bareRepo]);
  const seed = path.join(tmpRoot, "seed");
  await git(["clone", bareRepo, seed]);
  await fs.writeFile(path.join(seed, "README.md"), "# seed\n");
  await git(["-C", seed, "add", "-A"]);
  await git(["-C", seed, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);
  await git(["-C", seed, "push", "origin", "HEAD:main"]);

  // Fake host API: dispatch detail + PR open + result, with the git-proxy path
  // pointed straight at the local bare repo (cloneUrl = "" + gitProxyPath).
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const readBody = (cb: (b: string) => void) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => cb(data));
    };

    if (req.method === "GET" && url === `/api/agent-hosts/${AGENT_NODE_ID}/dispatch/${DISPATCH_ID}`) {
      send(200, {
        dispatch: {
          dispatchId: DISPATCH_ID,
          role: "implementer",
          input: "add greeting file",
          model: null,
          taskId: 1,
          repo: {
            repoId: "r1",
            provider: "github",
            owner: "o",
            repo: "r",
            defaultBranch: "main",
            gitProxyPath: bareRepo, // baseUrl is "" → cloneUrl === this local path
          },
        },
      });
      return;
    }
    if (
      req.method === "POST" &&
      url === `/api/agent-hosts/${AGENT_NODE_ID}/dispatch/${DISPATCH_ID}/pull-request`
    ) {
      readBody((b) => {
        recorded.pr = JSON.parse(b);
        send(200, { ok: true, url: "https://github.com/o/r/pull/1", number: 1 });
      });
      return;
    }
    if (req.method === "POST" && url === `/api/agent-hosts/${AGENT_NODE_ID}/dispatch-result`) {
      readBody((b) => {
        recorded.result = JSON.parse(b);
        send(200, { ok: true });
      });
      return;
    }
    send(404, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("coding dispatch — end to end (real git + real fetch)", () => {
  it("clones, lets the agent edit, pushes a branch, opens a PR and reports completed", async () => {
    // Fake agent: write a real file into the cloned working dir (parsed from the
    // prompt, exactly as a real agent would receive it), as the "code edit".
    const agent: CodingDispatchAgent = {
      async run(_sessionKey, message) {
        const dirLine = message.split("\n").find((l) => l.trim().startsWith(workspaceDir));
        const dir = (dirLine ?? "").trim();
        await fs.writeFile(path.join(dir, "GREETING.txt"), "hello from the agent\n");
        return { ok: true, summary: "wrote GREETING.txt" };
      },
    };

    await runCodingDispatch(
      {
        http: makeCodingHttp({ baseUrl, agentNodeId: AGENT_NODE_ID, apiKey: API_KEY }),
        git: makeCodingGit({ apiKey: API_KEY }),
        agent,
        baseUrl: "", // so cloneUrl === gitProxyPath (the local bare repo)
        workspaceDir,
        joinPath: (...parts: string[]) => path.join(...parts),
      },
      DISPATCH_ID,
    );

    // 1. A PR was requested for the agent's branch.
    expect(recorded.pr).toBeTruthy();
    const pr = recorded.pr as { branch: string; base?: string };
    expect(pr.branch).toMatch(/^agent\//);
    expect(pr.base).toBe("main");

    // 2. The branch was really pushed to the upstream WITH the agent's change.
    const pushed = await readBranchFileFromBare(pr.branch, "GREETING.txt");
    expect(pushed).toContain("hello from the agent");

    // 3. A terminal completed result was reported (drives swimlane advance).
    const result = recorded.result as { dispatchId: string; status: string; output?: string };
    expect(result.dispatchId).toBe(DISPATCH_ID);
    expect(result.status).toBe("completed");
    expect(result.output).toContain("PR #1");
  }, 60_000);
});
