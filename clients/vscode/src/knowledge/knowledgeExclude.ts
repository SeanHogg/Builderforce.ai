/**
 * Exclude from review (PRD 41 A9): the map found a folder inside the review root that should not be
 * reviewed (a loose copy of another system) and the person chose to exclude it. This appends the folder
 * to the root's `.builderforce/ignore` — the file `planReview` already reads — and nothing else; the
 * view then runs its normal Re-review (plan, estimate, confirm), which no longer lists the folder.
 *
 * Pure over {@link IgnoreFilePort}, so it is tested without an extension host.
 */

import * as vscode from "vscode";

/** The root's ignore file, as text. `write` replaces it whole and atomically. */
export interface IgnoreFilePort {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** A root-relative folder path that is safe to write as an ignore line, normalized; undefined when it is not. */
export function ignorablePath(raw: string): string | undefined {
  const path = raw.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (!path || path === "." || /[\r\n\0]/.test(path) || path.startsWith("#") || path.startsWith("!")) return undefined;
  if (path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return undefined;
  return path;
}

/** `text` with `path/` as a line of its own, once. The rest of the file is kept as written. */
export function withIgnoredFolder(text: string | undefined, path: string): string {
  const line = `${path}/`;
  const body = text ?? "";
  const present = body.split(/\r?\n/).some((l) => l.trim().replace(/^\//, "") === line);
  if (present) return body;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  return `${body}${body === "" || body.endsWith("\n") ? "" : eol}${line}${eol}`;
}

/** Adds the folder to the root's ignore file. Throws a localized error for an unusable path or a root being reviewed. */
export async function excludeFromReview(args: {
  rootId: string;
  path: string;
  file: IgnoreFilePort;
  isReviewing(rootId: string): boolean;
}): Promise<void> {
  if (args.isReviewing(args.rootId)) throw new Error(vscode.l10n.t("A review of this folder is already running."));
  const path = ignorablePath(args.path);
  if (!path) throw new Error(vscode.l10n.t("That path cannot be excluded from review."));
  const before = await args.file.read();
  const after = withIgnoredFolder(before, path);
  if (after !== (before ?? "")) await args.file.write(after);
}
