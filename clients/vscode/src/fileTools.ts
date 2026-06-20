import * as fs from "fs/promises";
import * as path from "path";

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
  execute: (args: Record<string, unknown>, root: string) => Promise<string>;
}

const MAX_READ_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 500;

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
    default:
      return name;
  }
}
