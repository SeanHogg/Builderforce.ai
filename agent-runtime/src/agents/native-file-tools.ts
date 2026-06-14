/**
 * Native file tools — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `createReadTool`/`createWriteTool`/`createEditTool` (PI cutover). Returns native
 * {@link AgentTool}s with schemas + behavior faithful to pi 0.54: `read` (offset/limit +
 * head truncation to 2000 lines / 50KB, image attachments by MIME), `write` (mkdir -p +
 * overwrite), `edit` (exact unique-match replace, BOM/CRLF tolerant). `pi-tools.read.ts`'s
 * Claude-compat + workspace-root + param-normalization wrappers continue to apply on top.
 */

import { constants } from "node:fs";
import {
  access as fsAccess,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve as resolvePath } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "../builderforce/model/agent-types.js";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});
const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
  newText: Type.String({ description: "New text to replace the old text with" }),
});

function resolveToCwd(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolvePath(cwd, path);
}

/** Pluggable file operations (override to delegate to a sandbox / remote host). */
export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}
export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}
export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
}

const defaultReadOps: ReadOperations = {
  readFile: (p) => fsReadFile(p),
  access: (p) => fsAccess(p, constants.R_OK),
};
const defaultWriteOps: WriteOperations = {
  writeFile: (p, c) => fsWriteFile(p, c, "utf-8"),
  mkdir: (d) => fsMkdir(d, { recursive: true }).then(() => undefined),
};
const defaultEditOps: EditOperations = {
  readFile: (p) => fsReadFile(p),
  access: (p) => fsAccess(p, constants.R_OK),
  writeFile: (p, c) => fsWriteFile(p, c, "utf-8"),
};

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  outputLines: number;
  firstLineExceedsLimit: boolean;
}

/** Head-truncate to maxLines / maxBytes (whichever hits first). Faithful to pi's truncateHead. */
function truncateHead(
  content: string,
  maxLines = DEFAULT_MAX_LINES,
  maxBytes = DEFAULT_MAX_BYTES,
): TruncationResult {
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      outputLines: totalLines,
      firstLineExceedsLimit: false,
    };
  }
  if (Buffer.byteLength(lines[0], "utf-8") > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      outputLines: 0,
      firstLineExceedsLimit: true,
    };
  }
  const out: string[] = [];
  let bytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const lineBytes = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0);
    if (bytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    out.push(lines[i]);
    bytes += lineBytes;
  }
  return {
    content: out.join("\n"),
    truncated: true,
    truncatedBy,
    totalLines,
    outputLines: out.length,
    firstLineExceedsLimit: false,
  };
}

function abortable<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error("Operation aborted"));
  return fn();
}

export function createReadTool(
  cwd: string,
  options?: { operations?: ReadOperations },
): AgentTool<typeof readSchema> {
  const ops = options?.operations ?? defaultReadOps;
  return {
    name: "read",
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files.`,
    parameters: readSchema,
    execute: async (
      _id,
      params,
      signal,
    ): Promise<AgentToolResult<{ truncation?: TruncationResult }>> => {
      const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };
      const abs = resolveToCwd(path, cwd);
      return abortable(signal, async () => {
        await ops.access(abs);
        const mime =
          (await ops.detectImageMimeType?.(abs)) ?? IMAGE_MIME[extname(abs).toLowerCase()];
        const buffer = await ops.readFile(abs);
        if (mime) {
          return {
            content: [
              { type: "text", text: `Read image file [${mime}]` },
              { type: "image", data: buffer.toString("base64"), mimeType: mime },
            ],
            details: {},
          };
        }
        const allLines = buffer.toString("utf-8").split("\n");
        const startLine = offset ? Math.max(0, offset - 1) : 0;
        if (startLine >= allLines.length) {
          throw new Error(
            `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
          );
        }
        const selected =
          limit !== undefined
            ? allLines.slice(startLine, Math.min(startLine + limit, allLines.length)).join("\n")
            : allLines.slice(startLine).join("\n");
        const truncation = truncateHead(selected);
        let text = truncation.content;
        if (truncation.firstLineExceedsLimit) {
          text = `[Line ${startLine + 1} exceeds ${DEFAULT_MAX_BYTES / 1024}KB limit. Use bash: sed -n '${startLine + 1}p' ${path}]`;
        } else if (truncation.truncated) {
          const endLine = startLine + truncation.outputLines;
          text += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${truncation.totalLines}. Use offset=${endLine + 1} to continue.]`;
        }
        return { content: [{ type: "text", text }], details: { truncation } };
      });
    },
  };
}

export function createWriteTool(
  cwd: string,
  options?: { operations?: WriteOperations },
): AgentTool<typeof writeSchema> {
  const ops = options?.operations ?? defaultWriteOps;
  return {
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeSchema,
    execute: async (_id, params, signal): Promise<AgentToolResult<undefined>> => {
      const { path, content } = params as { path: string; content: string };
      const abs = resolveToCwd(path, cwd);
      return abortable(signal, async () => {
        await ops.mkdir(dirname(abs));
        await ops.writeFile(abs, content);
        return {
          content: [
            { type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` },
          ],
          details: undefined,
        };
      });
    },
  };
}

export function createEditTool(
  cwd: string,
  options?: { operations?: EditOperations },
): AgentTool<typeof editSchema> {
  const ops = options?.operations ?? defaultEditOps;
  return {
    name: "edit",
    label: "edit",
    description:
      "Replace an exact, unique span of text in a file. `oldText` must match exactly (including whitespace/newlines) and occur exactly once.",
    parameters: editSchema,
    execute: async (_id, params, signal): Promise<AgentToolResult<undefined>> => {
      const { path, oldText, newText } = params as {
        path: string;
        oldText: string;
        newText: string;
      };
      const abs = resolveToCwd(path, cwd);
      return abortable(signal, async () => {
        try {
          await ops.access(abs);
        } catch {
          throw new Error(`File not found: ${path}`);
        }
        const raw = (await ops.readFile(abs)).toString("utf-8");
        // BOM/CRLF tolerant exact match.
        const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
        const lf = (s: string) => s.replace(/\r\n/g, "\n");
        const content = lf(stripBom(raw));
        const needle = lf(oldText);
        const first = content.indexOf(needle);
        if (first === -1) {
          throw new Error(
            `Could not find the exact text in ${path}. It must match exactly including whitespace and newlines.`,
          );
        }
        if (content.indexOf(needle, first + needle.length) !== -1) {
          throw new Error(
            `The text to replace is not unique in ${path}. Include more surrounding context so it matches exactly once.`,
          );
        }
        const updated =
          content.slice(0, first) + lf(newText) + content.slice(first + needle.length);
        await ops.writeFile(abs, updated);
        return {
          content: [{ type: "text", text: `Successfully edited ${path}` }],
          details: undefined,
        };
      });
    },
  };
}
