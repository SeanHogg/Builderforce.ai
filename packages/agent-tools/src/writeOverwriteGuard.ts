/**
 * Guards `write_file` against the two failure modes that clobber a real file:
 *
 * 1. A failed or empty read of a path that already exists is NOT "the file is
 *    empty" — it is a hard stop. Creating a new file (read 404 / not found) is
 *    still allowed.
 * 2. Replacing a large existing file with a much smaller body is almost always
 *    an accidental rewrite. Prefer `edit_file`. There is no force flag.
 *
 * Surfaces without `repo.read` skip the tool-level probe; provider write paths
 * (e.g. `commitFileToRepo`) still apply the same shrink rule from the existing
 * file's reported size.
 */
import type { RepoReadResult } from "./capabilities.js";

/** Existing file is "large" enough that shrinking it is a likely clobber. ~2 KiB. */
export const WRITE_OVERWRITE_LARGE_BYTES = 2048;

/** Incoming body must be at least this fraction of a large existing file. */
export const WRITE_OVERWRITE_SHRINK_RATIO = 0.5;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type WriteOverwriteProbe =
  | { status: "missing" }
  | { status: "unreadable"; reason: string }
  | { status: "ok"; bytes: number; truncated?: boolean };

const NOT_FOUND = /not found|no such file|enoent|does not exist|404\b/i;

export function isNotFoundReadError(error: string | undefined): boolean {
  return !!error && NOT_FOUND.test(error);
}

export function probeFromRepoRead(read: RepoReadResult): WriteOverwriteProbe {
  if (!read.ok) {
    if (isNotFoundReadError(read.error)) return { status: "missing" };
    return { status: "unreadable", reason: read.error?.trim() || "read failed" };
  }
  const content = read.content ?? "";
  if (read.truncated) {
    const contentLines = content === "" ? 0 : content.split(/\r?\n/).length;
    const totalLines =
      typeof read.totalLines === "number" && Number.isFinite(read.totalLines) ? read.totalLines : null;
    if (totalLines != null && contentLines > 0) {
      const windowBytes = utf8ByteLength(content);
      return { status: "ok", bytes: Math.round(windowBytes * (totalLines / contentLines)), truncated: true };
    }
    return {
      status: "unreadable",
      reason: "read was truncated; refusing to overwrite without the full file",
    };
  }
  if (content === "") {
    // Confirmed empty (totalLines 0) may be filled. An empty success without that
    // confirmation is the incident: treating a failed read as an empty file.
    if (read.totalLines === 0) return { status: "ok", bytes: 0 };
    return {
      status: "unreadable",
      reason: "read returned empty contents; refusing to treat that as an empty file",
    };
  }
  return { status: "ok", bytes: utf8ByteLength(content) };
}

export function refuseWriteOverwrite(probe: WriteOverwriteProbe, incoming: string): string | null {
  if (probe.status === "missing") return null;
  if (probe.status === "unreadable") {
    return `cannot overwrite: ${probe.reason}. A failed or empty read is not an empty file — use edit_file after a successful read, or create a new path.`;
  }
  const incomingBytes = utf8ByteLength(incoming);
  if (
    probe.bytes >= WRITE_OVERWRITE_LARGE_BYTES &&
    incomingBytes < probe.bytes * WRITE_OVERWRITE_SHRINK_RATIO
  ) {
    return `refusing to replace a large existing file (${probe.bytes} bytes) with a much smaller body (${incomingBytes} bytes). Use edit_file for surgical changes.`;
  }
  return null;
}
