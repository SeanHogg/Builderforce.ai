import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * One definition per tool: name, JSON-schema params, whether it mutates the
 * workspace, and the executor. The agent loop turns these into OpenAI tool specs
 * and dispatches results — so the tool contract lives in exactly one place (DRY).
 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutating: boolean;
  /**
   * Remote (platform) tools run server-side via the gateway MCP relay and need no
   * workspace root — they're available in chat-only mode too. Local file tools
   * leave this falsy and require a root. The agent loop branches on it.
   */
  remote?: boolean;
  execute: (args: Record<string, unknown>, root: string) => Promise<string>;
}

const MAX_READ_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 500;

// run_command: bound a command's wall-clock + the output handed back to the model.
const RUN_TIMEOUT_MS = 120_000;
const RUN_MAX_BUFFER = 4 * 1024 * 1024;
const RUN_MAX_OUTPUT = 60_000;

// search_code: keep the workspace walk bounded so a huge repo can't hang the host.
const SEARCH_MAX_MATCHES = 100;
const SEARCH_MAX_FILES = 4_000;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", ".vercel", ".cache",
]);

/** Clamp a tool's output so a noisy command / wide search can't blow the context. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(${text.length - max} more chars truncated)`;
}

/** Resolve `rel` under `root`, rejecting any path that escapes the workspace. */
function resolveInRoot(root: string, rel: unknown): string {
  if (typeof rel !== "string" || rel.length === 0) {
    throw new Error("a 'path' string is required");
  }
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  const within = path.relative(rootResolved, abs);
  if (within === "" ) return abs;
  if (within.startsWith("..") || path.isAbsolute(within)) {
    throw new Error(`path escapes the workspace: ${rel}`);
  }
  return abs;
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`'${key}' must be a string`);
  return v;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace. Returns its contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace root." } },
      required: ["path"],
    },
    mutating: false,
    execute: async (args, root) => {
      const abs = resolveInRoot(root, args.path);
      const stat = await fs.stat(abs);
      if (stat.size > MAX_READ_BYTES) {
        return `File is too large to read (${stat.size} bytes; limit ${MAX_READ_BYTES}).`;
      }
      return await fs.readFile(abs, "utf-8");
    },
  },
  {
    name: "list_files",
    description: "List entries in a workspace directory (non-recursive). Directories end with '/'.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory relative to root. Defaults to '.'." } },
    },
    mutating: false,
    execute: async (args, root) => {
      const rel = typeof args.path === "string" && args.path ? args.path : ".";
      const abs = resolveInRoot(root, rel);
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const lines = entries
        .slice(0, MAX_LIST_ENTRIES)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      const more = entries.length > MAX_LIST_ENTRIES ? `\n…(${entries.length - MAX_LIST_ENTRIES} more)` : "";
      return lines.join("\n") + more || "(empty)";
    },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file with the given content. Creates parent directories as needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        content: { type: "string", description: "Full file content." },
      },
      required: ["path", "content"],
    },
    mutating: true,
    execute: async (args, root) => {
      const abs = resolveInRoot(root, args.path);
      const content = str(args, "content");
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf-8");
      return `Wrote ${args.path} (${Buffer.byteLength(content)} bytes).`;
    },
  },
  {
    name: "edit_file",
    description:
      "Replace the first exact occurrence of old_string with new_string in an existing file. old_string must match uniquely.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        old_string: { type: "string", description: "Exact text to replace (must be unique)." },
        new_string: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old_string", "new_string"],
    },
    mutating: true,
    execute: async (args, root) => {
      const abs = resolveInRoot(root, args.path);
      const oldStr = str(args, "old_string");
      const newStr = str(args, "new_string");
      const current = await fs.readFile(abs, "utf-8");
      const first = current.indexOf(oldStr);
      if (first === -1) throw new Error("old_string not found in file");
      if (current.indexOf(oldStr, first + oldStr.length) !== -1) {
        throw new Error("old_string is not unique; add more context");
      }
      await fs.writeFile(abs, current.replace(oldStr, newStr), "utf-8");
      return `Edited ${args.path}.`;
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace root." } },
      required: ["path"],
    },
    mutating: true,
    execute: async (args, root) => {
      const abs = resolveInRoot(root, args.path);
      await fs.rm(abs);
      return `Deleted ${args.path}.`;
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the workspace (e.g. run tests, build, lint, typecheck, install deps, or git/gh). Returns stdout, stderr, and the exit code. Use this to VERIFY your edits and to commit/push/open a PR. Times out after 2 minutes.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The exact command line to run, e.g. 'pnpm test' or 'git commit -am \"fix\"'." },
        cwd: { type: "string", description: "Directory to run in, relative to the workspace root. Defaults to the root." },
      },
      required: ["command"],
    },
    mutating: true,
    execute: async (args, root) => {
      const command = str(args, "command");
      const cwd = typeof args.cwd === "string" && args.cwd ? resolveInRoot(root, args.cwd) : path.resolve(root);
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: RUN_TIMEOUT_MS,
          maxBuffer: RUN_MAX_BUFFER,
          windowsHide: true,
        });
        const out = [stdout, stderr].filter((s) => s && s.trim()).join("\n").trim();
        return clamp(`exit code: 0\n${out || "(no output)"}`, RUN_MAX_OUTPUT);
      } catch (e) {
        // exec rejects on a non-zero exit or timeout; surface the code + output so
        // the model can read a failing test / lint and fix it (not just "it failed").
        const err = e as { code?: number | string; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
        if (err.killed || err.signal === "SIGTERM") {
          return clamp(`Command timed out after ${RUN_TIMEOUT_MS / 1000}s.\n${(err.stdout ?? "") + (err.stderr ?? "")}`.trim(), RUN_MAX_OUTPUT);
        }
        const out = [err.stdout, err.stderr].filter((s) => s && String(s).trim()).join("\n").trim();
        return clamp(`exit code: ${err.code ?? "unknown"}\n${out || err.message || "(no output)"}`, RUN_MAX_OUTPUT);
      }
    },
  },
  {
    name: "search_code",
    description:
      "Search the workspace for a regular expression and return matching lines as 'path:line: text'. Use this to FIND the right code to change before editing. Skips node_modules/.git/build output.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A regular expression (JavaScript syntax) to search for." },
        path: { type: "string", description: "Subdirectory to search, relative to root. Defaults to the whole workspace." },
        ignoreCase: { type: "boolean", description: "Case-insensitive match. Default true." },
      },
      required: ["query"],
    },
    mutating: false,
    execute: async (args, root) => {
      const query = str(args, "query");
      let re: RegExp;
      try {
        re = new RegExp(query, args.ignoreCase === false ? "" : "i");
      } catch (e) {
        throw new Error(`invalid 'query' regex: ${e instanceof Error ? e.message : String(e)}`);
      }
      const start = typeof args.path === "string" && args.path ? resolveInRoot(root, args.path) : path.resolve(root);
      const rootResolved = path.resolve(root);

      const matches: string[] = [];
      let filesScanned = 0;
      let truncated = false;

      async function walk(dir: string): Promise<void> {
        if (matches.length >= SEARCH_MAX_MATCHES || filesScanned >= SEARCH_MAX_FILES) return;
        let entries: import("fs").Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return; // unreadable dir — skip
        }
        for (const entry of entries) {
          if (matches.length >= SEARCH_MAX_MATCHES || filesScanned >= SEARCH_MAX_FILES) {
            truncated = true;
            return;
          }
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (SEARCH_SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
            await walk(abs);
          } else if (entry.isFile()) {
            let stat: import("fs").Stats;
            try {
              stat = await fs.stat(abs);
            } catch {
              continue;
            }
            if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
            filesScanned++;
            let content: string;
            try {
              content = await fs.readFile(abs, "utf-8");
            } catch {
              continue;
            }
            if (content.includes("\u0000")) continue; // binary — skip
            const rel = path.relative(rootResolved, abs).split(path.sep).join("/");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                if (matches.length >= SEARCH_MAX_MATCHES) { truncated = true; break; }
              }
            }
          }
        }
      }

      await walk(start);
      if (matches.length === 0) return "No matches.";
      const note = truncated ? `\n…(stopped at ${matches.length} matches / ${filesScanned} files — narrow the query or path)` : "";
      return matches.join("\n") + note;
    },
  },
];

/** Human-readable one-liner for an approval prompt / activity row. */
export function describeTool(name: string, args: Record<string, unknown>): string {
  const p = typeof args.path === "string" ? args.path : "";
  switch (name) {
    case "write_file":
      return `write ${p}`;
    case "edit_file":
      return `edit ${p}`;
    case "delete_file":
      return `delete ${p}`;
    case "read_file":
      return `read ${p}`;
    case "list_files":
      return `list ${p || "."}`;
    case "run_command":
      return `run: ${typeof args.command === "string" ? args.command.slice(0, 80) : ""}`;
    case "search_code":
      return `search ${typeof args.query === "string" ? `"${args.query.slice(0, 60)}"` : ""}`;
    default:
      return name;
  }
}
