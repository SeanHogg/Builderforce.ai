/**
 * `a2a-send` — send a message to a remote A2A agent.
 *
 * The wire contract is the generic A2A envelope (see
 * `packages/agent-tools/src/a2a.ts`), so ANY agent runtime that can POST JSON
 * and read a JSON or SSE response can participate — Google's A2A protocol,
 * LangGraph, Google ADK, Microsoft Agent Framework, etc.
 *
 * One transport target gets a dedicated local bridge: Claude Code's Agent SDK
 * exposes a streaming JSON surface via the CLI:
 *
 *     claude -p \
 *       --output-format stream-json \
 *       --input-format stream-json \
 *       --verbose
 *
 * feeding it newline-delimited JSON messages on stdin and reading
 * newline-delimited JSON events on stdout. This tool speaks that protocol over
 * stdio (no network) when target="claude-code", so the BuilderForce agent can
 * both SEND a message to Claude Code and READ its streamed reply.
 *
 * Every other A2A-compatible endpoint (a plain JSON responder, or another SSE
 * streamer) is reached over HTTP through the same call — the parser handles
 * both.
 */
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs"; 
// `existsSync` stays synchronous so `resolveClaudeBin` runs before spawn.

// ---------------------------------------------------------------------------
// Claude Code CLI bridge
// ---------------------------------------------------------------------------

export type ClaudeCodeResult = {
  reply: string;
  sessionId?: string;
  streamed: boolean;
  events: Array<Record<string, unknown>>;
};

type SpawnedChild = {
  stdin: { write: (s: string) => void; end: () => void };
  stdout: AsyncIterable<string>;
  kill: () => void;
  wait: () => Promise<{ code: number | null }>;
};

const CLAUDE_TIMEOUT_MS = 120_000;

/**
 * On Windows, `spawn("claude", …)` looks up `claude` with no extension and
 * fails ENOENT even when Claude Code is installed (the shim is `claude.cmd` /
 * `claude.bat`). Resolve the shim explicitly. Prefer a real `.exe` so the child
 * can be spawned directly; batch shims are run through the command interpreter
 * by `spawnClaude` with a single pre-quoted command line, never a shell string
 * built from raw args (a correctness bug and a command-injection vector when an
 * arg is influenced by remote A2A content or config).
 */
function resolveClaudeBin(bin: string): string {
  if (process.platform !== "win32" || bin.includes("\\") || bin.includes("/")) {
    return bin;
  }
  const pathEnv = process.env.PATH ?? "";
  // Prefer .exe: it is a real executable and spawns without the command interpreter.
  const exts = ["exe", "cmd", "bat"];
  for (const dir of pathEnv.split(";")) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = `${dir}\\${bin}.${ext}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return bin;
}

/**
 * Spawn the resolved Claude CLI with per-call options — `process.env` is
 * snapshotted here, not at module load, so env changes made after startup
 * (credentials set later, per-call env) are seen by the child, and no options
 * object is shared across calls.
 */
function spawnClaude(bin: string, args: string[]): import("node:child_process").ChildProcess {
  const env = { ...process.env };
  const options: import("node:child_process").SpawnOptions = {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  };
  const resolved = resolveClaudeBin(bin);
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    // Batch shims are not executables — CreateProcess can't run them directly. Drive
    // the command interpreter with ONE pre-quoted command line (no raw-arg string
    // building): every argv element is individually double-quoted so spaces and cmd
    // metacharacters (& | ^ > <) inside caller-influenced values stay literal.
    const comspec = process.env.COMSPEC ?? "cmd.exe";
    const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;
    const cmdLine = [quote(resolved), ...args.map(quote)].join(" ");
    return spawn(process.env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", cmdLine], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(resolved, args, options);
}

/**
 * Spawn the local `claude` CLI in streaming mode and exchange one message.
 * Resolved purely over stdio — no network — so it works against the installed
 * Claude Code without any extra credential plumbing.
 */
export async function talkToClaudeCode(
  message: string,
  options: { sessionId?: string; skill?: string } = {},
): Promise<ClaudeCodeResult> {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
  ];
  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  // Resolve the binary once (it's on PATH in dev; fall back to npx).
  const bin = process.env.CLAUDE_CODE_BIN ?? "claude";

  const events: Array<Record<string, unknown>> = [];
  let reply = "";
  let sessionId: string | undefined;
  let terminal: Record<string, unknown> | undefined;

  const started = Date.now();

  await new Promise<void>((resolve, reject) => {
    const child = spawnClaude(bin, args);

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already dead */ }
      finish(() => reject(new Error(`claude CLI timed out after ${CLAUDE_TIMEOUT_MS}ms`)));
    }, CLAUDE_TIMEOUT_MS);

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return; // ignore non-JSON noise
      }
      events.push(ev);

      if (typeof ev.session_id === "string") {
        sessionId = ev.session_id;
      }
      if (ev.type === "assistant") {
        const content = (ev.message as { content?: Array<{ type: string; text?: string }> } | undefined)
          ?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "text" && typeof block.text === "string") {
              reply += block.text;
            }
          }
        }
      }
      if (ev.type === "result") {
        terminal = ev;
        // A bare `result` with a string payload is the final answer.
        if (typeof ev.result === "string" && !reply) {
          reply = ev.result;
        }
        try { child.stdin?.end(); } catch { /* already closed */ }
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      finish(() => reject(new Error(`failed to spawn claude CLI: ${err.message}`)));
    });

    child.on("close", (code) => {
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      if (settled) return;
      if (terminal) {
        finish(() => resolve());
        return;
      }
      finish(() =>
        reject(
          new Error(
            `claude CLI exited (code ${code}) without a result event: ${stderrBuf.trim() || "no stderr"}`,
          ),
        ),
      );
    });

    // Kick off the conversation.
    const first = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: message }],
      },
    };
    child.stdin?.write(JSON.stringify(first) + "\n");
  });

  if (!reply.trim()) {
    throw new Error("claude CLI returned an empty reply");
  }

  return { reply: reply.trim(), sessionId, streamed: true, events };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createA2aSendTool() {
  return {
    name: "a2a-send",
    label: "A2A Send",
    description:
      "Send a message to a remote A2A agent and read its reply. " +
      "Use target=\"claude-code\" to talk to the local Claude Code agent, " +
      "or pass an http(s) endpoint URL for any other A2A-compatible agent. " +
      "Returns the remote agent's reply text plus its session id (for follow-ups).",
    parameters: Type.Object({
      message: Type.String({ description: "The message to send to the remote agent." }),
      target: Type.Optional(
        Type.String({
          description:
            'Either "claude-code" (the local Claude Code CLI) or an http(s) endpoint URL of another A2A agent.',
        }),
      ),
      sessionId: Type.Optional(
        Type.String({ description: "Resume a previous remote-agent conversation by its session id." }),
      ),
      skill: Type.Optional(
        Type.String({ description: "Optional skill / sub-agent name to route to on the remote side." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const message = typeof params.message === "string" ? params.message : "";
      if (!message.trim()) {
        throw new Error("a2a-send: `message` is required");
      }
      const target =
        (typeof params.target === "string" && params.target.trim()) || "claude-code";
      const sessionId = typeof params.sessionId === "string" && params.sessionId.trim() ? params.sessionId : undefined;
      const skill = typeof params.skill === "string" && params.skill.trim() ? params.skill : undefined;

      if (target === "claude-code" || target === "claude") {
        const result = await talkToClaudeCode(message, { sessionId, skill });
        return {
          content: [{ type: "text", text: result.reply }],
          details: {
            target: "claude-code",
            reply: result.reply,
            sessionId: result.sessionId ?? null,
            streamed: result.streamed,
            eventCount: result.events.length,
          },
        };
      }

      if (!/^https?:\/\//i.test(target)) {
        throw new Error(
          `a2a-send: unknown target "${target}". Use "claude-code" or an http(s) URL.`,
        );
      }

      // Generic A2A HTTP endpoint.
      const { sendMessage } = await import("@builderforce/agent-tools/a2a.js");
      const result = await sendMessage(
        target,
        {
          message: {
            role: "user",
            parts: [{ type: "text", text: message }],
          },
          sessionId,
          skill,
        },
        { timeoutMs: CLAUDE_TIMEOUT_MS },
      );

      const replyText =
        result.message?.parts.map((p) => p.text ?? "").join("").trim() ?? "";
      return {
        content: [{ type: "text", text: replyText || "(no reply body)" }],
        details: {
          target,
          reply: replyText,
          status: result.status,
          sessionId: result.sessionId ?? null,
          streamed: result.streamed,
          eventCount: result.events.length,
        },
      };
    },
  };
}
