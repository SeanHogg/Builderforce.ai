/**
 * BuilderForceAgentsLLM tool execution.
 *
 * Supported tools (model outputs a JSON object with a "tool" key):
 *   {"tool": "read_file",   "path": "src/foo.ts"}
 *   {"tool": "list_files",  "dir":  "src/"}
 *   {"tool": "grep_files",  "pattern": "useEffect", "dir": "src/"}
 *   {"tool": "run_code",    "code": "console.log(1+1)", "lang": "js"}
 *
 * Security note: run_code executes model-generated code in a child process.
 * It is sandboxed to a 10-second timeout and the workspace directory, but it
 * runs with the same OS privileges as the BuilderForceAgents process.  Only enable
 * when the user has explicitly opted into the builderforcellm-local provider.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CODE_EXEC_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 4_000;
const MAX_FILE_CHARS = 8_000;
const MAX_LIST_ENTRIES = 60;

// ── Tool call types ───────────────────────────────────────────────────────────

export type ToolCall =
  | { tool: "read_file"; path: string }
  | { tool: "list_files"; dir?: string }
  | { tool: "grep_files"; pattern: string; dir?: string }
  | { tool: "run_code"; code: string; lang?: string };

export type ToolResult = {
  tool: string;
  output: string;
};

// ── Tool descriptions injected into the brain system prompt ──────────────────

export const TOOL_USAGE_HINT = `\
You may call tools by outputting a JSON object (one per line) with a "tool" key:
  {"tool": "read_file",  "path": "src/index.ts"}
  {"tool": "list_files", "dir": "src/"}
  {"tool": "grep_files", "pattern": "useState", "dir": "src/"}
  {"tool": "run_code",   "code": "console.log(process.version)", "lang": "js"}
Tool results will be fed back to you automatically.`;

// ── Parse tool calls from model output ───────────────────────────────────────

const TOOL_JSON_RE = /\{[^{}\n]*"tool"\s*:\s*"[^"]*"[^{}\n]*\}/g;

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const raw of text.match(TOOL_JSON_RE) ?? []) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (typeof obj.tool !== "string") {
        continue;
      }
      calls.push(obj as unknown as ToolCall);
    } catch {
      // malformed JSON — skip
    }
  }
  return calls;
}

// ── Path sandboxing ───────────────────────────────────────────────────────────

function sandboxedPath(workspaceDir: string, userPath: string): string {
  const workspaceRoot = path.resolve(workspaceDir);
  const resolved = path.resolve(workspaceRoot, userPath);
  const relative = path.relative(workspaceRoot, resolved);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Path traversal blocked: ${userPath}`);
  }
  return resolved;
}

// ── Individual tool implementations ──────────────────────────────────────────

async function toolReadFile(workspaceDir: string, call: { path: string }): Promise<string> {
  const target = sandboxedPath(workspaceDir, call.path);
  const content = await fs.readFile(target, "utf-8");
  return content.length > MAX_FILE_CHARS
    ? `${content.slice(0, MAX_FILE_CHARS)}\n…(truncated)`
    : content;
}

async function toolListFiles(workspaceDir: string, call: { dir?: string }): Promise<string> {
  const target = sandboxedPath(workspaceDir, call.dir ?? ".");
  const entries = await fs.readdir(target, { withFileTypes: true });
  const lines = entries
    .slice(0, MAX_LIST_ENTRIES)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  if (entries.length > MAX_LIST_ENTRIES) {
    lines.push(`…(${entries.length - MAX_LIST_ENTRIES} more)`);
  }
  return lines.join("\n") || "(empty)";
}

async function toolGrepFiles(
  workspaceDir: string,
  call: { pattern: string; dir?: string },
): Promise<string> {
  const target = sandboxedPath(workspaceDir, call.dir ?? ".");
  const pattern = call.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(pattern, "i");
  const matches: string[] = [];

  async function walk(dir: string) {
    if (matches.length >= 20) {
      return;
    }
    let entries: import("node:fs").Dirent<string>[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= 20) {
        break;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        await walk(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|md|json)$/.test(entry.name)) {
        try {
          const text = await fs.readFile(full, "utf-8");
          const rel = path.relative(workspaceDir, full);
          text.split("\n").forEach((line, i) => {
            if (matches.length < 20 && re.test(line)) {
              matches.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
            }
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(target);
  return matches.length > 0 ? matches.join("\n") : "(no matches)";
}

async function toolRunCode(
  workspaceDir: string,
  call: { code: string; lang?: string },
): Promise<string> {
  const lang = (call.lang ?? "js").toLowerCase();
  const isTs = lang === "ts" || lang === "typescript";
  const ext = isTs ? ".ts" : ".mjs";

  // TypeScript execution requires tsx, which is a devDependency.
  // Check at runtime so consumers without tsx get a clear message.
  if (isTs) {
    try {
      // @ts-expect-error -- tsx has no type declarations; runtime-only check
      await import("tsx");
    } catch {
      return (
        "Error: TypeScript code execution requires 'tsx' to be installed. " +
        "Run `npm install tsx` (or pnpm/yarn equivalent), then retry. " +
        "Alternatively, provide the code in JavaScript."
      );
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `builderforcellm-${process.pid}-`));
  const tmpFile = path.join(tmpDir, `run${ext}`);

  try {
    await fs.writeFile(tmpFile, call.code, "utf-8");

    const [cmd, ...args] = isTs ? ["node", "--import", "tsx/esm", tmpFile] : ["node", tmpFile];

    const output = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      const proc = spawn(cmd, args, {
        cwd: workspaceDir,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
        timeout: CODE_EXEC_TIMEOUT_MS,
      });
      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr.on("data", (d: Buffer) => chunks.push(d));
      proc.on("close", () =>
        resolve(
          Buffer.concat(chunks).toString("utf-8").slice(0, MAX_OUTPUT_CHARS) || "(no output)",
        ),
      );
      proc.on("error", (err) => resolve(`Error: ${err.message.slice(0, MAX_OUTPUT_CHARS)}`));
    });
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg.slice(0, MAX_OUTPUT_CHARS)}`;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Public executor ───────────────────────────────────────────────────────────

export type ExecuteToolCallOptions = {
  /**
   * Explicit opt-in required to execute model-generated code via `run_code`.
   *
   * `run_code` spawns a Node.js child process with the same OS privileges as
   * the BuilderForceAgents process.  While it is sandboxed to the workspace directory
   * and a 10-second timeout, the code runs without containerisation.
   *
   * Set to `true` only when the user has knowingly opted into the
   * `builderforcellm-local` provider (local brain, local execution).
   * Defaults to `false` — `run_code` calls are blocked by default.
   */
  allowRunCode?: boolean;
};

export async function executeToolCall(
  call: ToolCall,
  workspaceDir: string,
  opts: ExecuteToolCallOptions = {},
): Promise<ToolResult> {
  try {
    let output: string;
    switch (call.tool) {
      case "read_file":
        output = await toolReadFile(workspaceDir, call);
        break;
      case "list_files":
        output = await toolListFiles(workspaceDir, call);
        break;
      case "grep_files":
        output = await toolGrepFiles(workspaceDir, call);
        break;
      case "run_code":
        if (!opts.allowRunCode) {
          output =
            "run_code is disabled. To allow model-generated code execution, enable the " +
            "builderforcellm-local provider (which sets allowRunCode) or pass allowRunCode: true " +
            "explicitly. See docs/SECURITY.md for the trust model.";
        } else {
          output = await toolRunCode(workspaceDir, call);
        }
        break;
      default:
        output = `Unknown tool: ${(call as ToolCall).tool}`;
    }
    return { tool: call.tool, output };
  } catch (err) {
    return {
      tool: call.tool,
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Format tool results as a context block ────────────────────────────────────

export function formatToolResults(results: ToolResult[]): string {
  return results.map((r) => `[Tool: ${r.tool}]\n${r.output}`).join("\n\n");
}

// ── Code block extraction (for execution feedback) ───────────────────────────

const CODE_BLOCK_RE = /```(?:ts|typescript|js|javascript|mjs)\n([\s\S]*?)```/gi;

export function extractCodeBlocks(text: string): Array<{ code: string; lang: string }> {
  const blocks: Array<{ code: string; lang: string }> = [];
  let match: RegExpExecArray | null;
  CODE_BLOCK_RE.lastIndex = 0;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    const fence = match[0].split("\n")[0].replace(/`/g, "").trim();
    blocks.push({ code: match[1].trim(), lang: fence || "js" });
  }
  return blocks;
}
