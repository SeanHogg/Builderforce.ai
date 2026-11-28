/**
 * Native file tools — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `createReadTool`/`createWriteTool`/`createEditTool` (PI cutover). Returns native
 * {@link AgentTool}s with schemas faithful to pi 0.54: `read` (offset/limit + head truncation to
 * the shared native-read caps, image attachments by MIME), `write`, `edit` (exact unique-match
 * replace, BOM/CRLF tolerant). `coding-tools.read.ts`'s Claude-compat + workspace-root +
 * param-normalization wrappers continue to apply on top.
 *
 * Every file operation runs on the ONE shared provider (`createRepoCapabilities` over a
 * {@link WorkspaceFs}): containment, size cap, error codes and the edit matcher are the provider's.
 * What stays here is the tool layer only: the schemas (`oldText`/`newText`), the line window and
 * head truncation (the model-output policy, caps from `@builderforce/tool-output-policy`), image
 * attachments, and staging, which is a {@link WorkspaceFs} decorator.
 */

import { readFile as fsReadFile } from "node:fs/promises";
import { extname, resolve as resolvePath } from "node:path";
import { detectMime } from "../media/mime.js";
import { sliceFileLines } from "@builderforce/agent-tools";
import { nodeWorkspaceFs } from "@builderforce/agent-tools/node-workspace";
import type { RepoEditResult } from "@builderforce/agent-tools";
import { createRepoCapabilities, type WorkspaceFs } from "@builderforce/agent-tools/workspace";
import {
  NATIVE_FILE_READ_MAX_BYTES as DEFAULT_MAX_BYTES,
  NATIVE_FILE_READ_MAX_LINES as DEFAULT_MAX_LINES,
} from "@builderforce/tool-output-policy";
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "../builderforce/model/agent-types.js";
import { getStagedEdit, isStagingActive, stageEdit } from "../builderforce/staged-edits.js";

export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES };

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

/** Where the tools read and write: a {@link WorkspaceFs} (disk by default, the sandbox's when sandboxed). */
export interface NativeFileToolOptions {
  /** The file system the shared provider runs on. Default: the local disk rooted at `cwd`. */
  fs?: WorkspaceFs;
  /** Paths may reach outside `cwd` (the caller's `workspaceOnly` is off). Default: confined to `cwd`. */
  unconfined?: boolean;
}

/** `read` only: image attachments need raw bytes, which a text {@link WorkspaceFs} does not carry. */
export interface NativeReadToolOptions extends NativeFileToolOptions {
  /**
   * Raw bytes of an image, given the path the provider resolved (root-relative, or the raw path when
   * unconfined). The sandbox reads through its bridge, which is its own boundary. Default: the host disk.
   */
  readImageBytes?: (resolvedPath: string) => Promise<Buffer>;
}

/** The whole-file read the pre-provider tools did: the line window and head truncation bound what the model sees, not the read. */
const WHOLE_FILE = Number.MAX_SAFE_INTEGER;

/** Extensions that go straight to an image sniff; any other file is sniffed only when its text looks binary. */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

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

/**
 * Staging as a {@link WorkspaceFs} decorator: while staging is active a write is buffered (not
 * landed) and a read sees the buffered content. `onStaged` receives the staging message.
 */
function stagingFs(
  base: WorkspaceFs,
  cwd: string,
  stage: { toolCallId: string; label: "write" | "edit"; onStaged: (message: string) => void },
): WorkspaceFs {
  return {
    ...base,
    async read(path, readOpts) {
      const staged = isStagingActive() ? getStagedEdit(resolvePath(cwd, path)) : undefined;
      return staged ? { status: "ok", content: staged.proposedContent, truncated: false } : base.read(path, readOpts);
    },
    async write(path, content) {
      if (!isStagingActive()) return base.write(path, content);
      stage.onStaged(
        stageEdit({ filePath: resolvePath(cwd, path), proposedContent: content, toolCallId: stage.toolCallId, label: stage.label }).message,
      );
    },
  };
}

/** The tool's file system: the caller's, else the local disk at `cwd` (confined unless `unconfined`). */
function baseFs(cwd: string, options: NativeFileToolOptions | undefined): WorkspaceFs {
  return options?.fs ?? nodeWorkspaceFs(cwd, { scope: options?.unconfined === true ? "unconfined" : "workspace" });
}

/** The shared provider over the tool's file system, with staging layered on. `onWrite` receives the stored text. */
function providerFor(
  cwd: string,
  options: NativeFileToolOptions | undefined,
  stage: { toolCallId: string; label: "write" | "edit"; onStaged: (message: string) => void },
  onWrite?: (written?: { content: string }) => void,
) {
  return createRepoCapabilities(stagingFs(baseFs(cwd, options), cwd, stage), {
    unconfined: options?.unconfined === true,
    maxReadBytes: WHOLE_FILE,
    ...(onWrite ? { onWrite: (_path, written) => onWrite(written) } : {}),
  });
}

/** Text that is really binary (a NUL in its head): worth a content sniff for an image. */
const looksBinary = (text: string): boolean => text.slice(0, 8192).includes("\u0000");

/**
 * The image attachment for `path`, or undefined when its bytes are not an image. Containment and
 * existence come from the provider (it resolves the path; a host disk is also probed), the type from
 * a content sniff (`detectMime`), and the bytes are read ONCE.
 */
async function readImageAttachment(
  cwd: string,
  path: string,
  options: NativeReadToolOptions | undefined,
): Promise<AgentToolResult<{ truncation?: TruncationResult }> | undefined> {
  const base = baseFs(cwd, options);
  const custom = options?.readImageBytes;
  let resolved = path;
  const resolver: WorkspaceFs = {
    ...base,
    // The provider resolves (and confines) the path; a zero-byte probe checks a host disk, never the bridge.
    read: async (p, readOpts) => {
      resolved = p;
      return custom ? { status: "ok", content: "", truncated: false } : base.read(p, readOpts);
    },
  };
  const probe = await createRepoCapabilities(resolver, { unconfined: options?.unconfined === true, maxReadBytes: 0 }).repoRead.readFile(path);
  if (!probe.ok) throw new Error(probe.error ?? `could not read ${path}`);
  let buffer: Buffer;
  try {
    buffer = await (custom ?? ((p: string) => fsReadFile(resolvePath(cwd, p))))(resolved);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(/ENOENT|No such file/.test(message) ? `file not found: ${path}` : `could not read ${path}`);
  }
  const mime = await detectMime({ buffer, filePath: path });
  if (!mime || !mime.startsWith("image/")) return undefined;
  return {
    content: [
      { type: "text", text: `Read image file [${mime}]` },
      { type: "image", data: buffer.toString("base64"), mimeType: mime },
    ],
    details: {},
  };
}

const noStage = (label: "write" | "edit") => ({ toolCallId: "", label, onStaged: () => {} });

export function createReadTool(
  cwd: string,
  options?: NativeReadToolOptions,
): AgentTool<typeof readSchema> {
  return {
    name: "read",
    idempotent: true,
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files.`,
    parameters: readSchema,
    execute: async (
      _id,
      params,
      signal,
    ): Promise<AgentToolResult<{ truncation?: TruncationResult }>> => {
      const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };
      return abortable(signal, async () => {
        const { repoRead } = providerFor(cwd, options, noStage("write"));
        if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
          const image = await readImageAttachment(cwd, path, options);
          if (image) return image;
        }
        const read = await repoRead.readFile(path);
        if (!read.ok) throw new Error(read.error ?? `could not read ${path}`);
        const text = read.content ?? "";
        if (looksBinary(text)) {
          // An image under a non-image name (or a misnamed one): the content decides.
          const image = await readImageAttachment(cwd, path, options);
          if (image) return image;
        }
        return readTextResult(path, text, offset, limit);
      });
    },
  };
}

function readTextResult(
  path: string,
  raw: string,
  offset: number | undefined,
  limit: number | undefined,
): AgentToolResult<{ truncation?: TruncationResult }> {
  const startLine = offset ? Math.max(0, offset - 1) : 0;
  const selected = sliceFileLines(raw, startLine, limit === undefined ? undefined : startLine + limit);
  if (startLine >= selected.totalLines) {
    throw new Error(`Offset ${offset} is beyond end of file (${selected.totalLines} lines total)`);
  }
  const truncation = truncateHead(selected.content);
  let text = truncation.content;
  if (truncation.firstLineExceedsLimit) {
    text = `[Line ${startLine + 1} exceeds ${DEFAULT_MAX_BYTES / 1024}KB limit. Use bash: sed -n '${startLine + 1}p' ${path}]`;
  } else if (truncation.truncated) {
    const endLine = startLine + truncation.outputLines;
    text += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${truncation.totalLines}. Use offset=${endLine + 1} to continue.]`;
  }
  return { content: [{ type: "text", text }], details: { truncation } };
}

export function createWriteTool(
  cwd: string,
  options?: NativeFileToolOptions,
): AgentTool<typeof writeSchema> {
  return {
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeSchema,
    execute: async (toolCallId, params, signal): Promise<AgentToolResult<undefined>> => {
      const { path, content } = params as { path: string; content: string };
      return abortable(signal, async () => {
        let stagedMessage: string | undefined;
        // The provider keeps an existing file's line endings, so the stored text can differ from `content`.
        let stored = content;
        const { repoWrite } = providerFor(cwd, options, { toolCallId, label: "write", onStaged: (m) => { stagedMessage = m; } }, (written) => {
          if (written) stored = written.content;
        });
        const result = await repoWrite.writeFile(path, content);
        if (!result.ok) throw new Error(result.error ?? `could not write ${path}`);
        return {
          content: [
            { type: "text", text: stagedMessage ?? `Successfully wrote ${Buffer.byteLength(stored, "utf-8")} bytes to ${path}` },
          ],
          details: undefined,
        };
      });
    },
  };
}

/**
 * The edit failure in THIS tool's vocabulary: the provider names `oldString`/`replaceAll`/`read_file`,
 * none of which this tool has. A path-bearing provider message (not_found, outside_root) passes through.
 */
function editFailureText(result: RepoEditResult, path: string): string {
  if (result.code === "ambiguous") {
    const count = result.matchCount === undefined ? "" : ` (${result.matchCount} matches)`;
    return `oldText is not unique${count}; add more surrounding context so it matches exactly once`;
  }
  if (result.code === "no_match") {
    const hint = result.nearest ? `\nNearest match at line ${result.nearest.line}:\n${result.nearest.excerpt}` : "";
    return `oldText not found in ${path}; read it with the read tool and copy the exact text (including indentation)${hint}`;
  }
  return result.error ?? `could not edit ${path}`;
}

export function createEditTool(
  cwd: string,
  options?: NativeFileToolOptions,
): AgentTool<typeof editSchema> {
  return {
    name: "edit",
    label: "edit",
    description:
      "Replace an exact, unique span of text in a file. `oldText` must match exactly (including whitespace/newlines) and occur exactly once.",
    parameters: editSchema,
    execute: async (toolCallId, params, signal): Promise<AgentToolResult<undefined>> => {
      const { path, oldText, newText } = params as {
        path: string;
        oldText: string;
        newText: string;
      };
      return abortable(signal, async () => {
        let stagedMessage: string | undefined;
        const { repoWrite } = providerFor(cwd, options, { toolCallId, label: "edit", onStaged: (m) => { stagedMessage = m; } });
        const result = await repoWrite.editFile(path, oldText, newText);
        if (!result.ok) throw new Error(editFailureText(result, path));
        return {
          content: [{ type: "text", text: stagedMessage ?? `Successfully edited ${path}` }],
          details: undefined,
        };
      });
    },
  };
}
