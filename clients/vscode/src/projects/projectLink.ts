/**
 * Which server project (and which AI project type) a workspace folder belongs to:
 * `.builderforce/project.json`, `{ "version": 1, "projectId", "projectType" }`. It is its own
 * file so the app manifest (`builderforce.json`, the runtime's schema) is never touched.
 * The selected project elsewhere in the extension is a global memento, not per folder, so
 * this is the only per-folder binding.
 *
 * Writes MERGE into any existing file (other members are kept), a leading BOM is ignored, and
 * a file that is not a JSON object is never overwritten.
 */
import { WORKSPACE_DIR } from "../composerCommands/manifestLocation";
import { inFolder, type ComposerWorkspacePort, type WorkspaceFolderRef } from "../composerCommands/workspacePort";

/** The link file's folder-relative POSIX path. */
export const PROJECT_LINK_PATH = `${WORKSPACE_DIR}/project.json`;

export interface ProjectLink {
  projectId: number;
  projectType: string;
}

/** What is on disk: any `projectId` (of whatever type) is a link, so a hand-edited one still conflicts. */
export interface ExistingLink {
  projectId: unknown;
  projectType: unknown;
}

/** The slice of the workspace port the link needs. */
export type ProjectLinkPort = Pick<ComposerWorkspacePort, "readText" | "writeText">;

export type ParsedLink =
  | { ok: true; members: Record<string, unknown> }
  | { ok: false; reason: "invalid-json" | "not-an-object" };

/** A leading byte-order mark (U+FEFF), spelled by code point so it is never an invisible character in source. */
const LEADING_BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** Parse the file text: blank is an empty link; a BOM is stripped first. */
export function parseProjectLinkText(text: string | undefined): ParsedLink {
  const body = (text ?? "").replace(LEADING_BOM, "");
  if (body.trim() === "") return { ok: true, members: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "not-an-object" };
  return { ok: true, members: parsed as Record<string, unknown> };
}

function linkOf(members: Record<string, unknown>): ExistingLink | undefined {
  const { projectId, projectType } = members;
  return projectId === undefined || projectId === null ? undefined : { projectId, projectType };
}

export type ReadLinkResult = { ok: true; link: ExistingLink | undefined } | { ok: false; reason: "invalid-json" | "not-an-object" };

/** The folder's link: `link` undefined when it has none. The reader every consumer of `projectType` uses. */
export async function readProjectLink(port: ProjectLinkPort, folder: WorkspaceFolderRef): Promise<ReadLinkResult> {
  const parsed = parseProjectLinkText(await port.readText(inFolder(folder, PROJECT_LINK_PATH)));
  return parsed.ok ? { ok: true, link: linkOf(parsed.members) } : parsed;
}

export type LinkResult =
  | { status: "written" | "unchanged" }
  /** A different project is linked and was not the one confirmed for replacement: nothing was written. */
  | { status: "conflict"; existing: ExistingLink }
  | { status: "refused"; reason: "invalid-json" | "not-an-object" };

/**
 * Link the folder to a project. An identical link is a no-op; a different `projectId` is a
 * conflict unless `replace.expectedProjectId` names exactly the id on disk (compare-and-swap:
 * the person agreed to replace THAT link, so one that changed since is a conflict again).
 * Other members of an existing file are kept.
 */
export async function linkProject(
  port: ProjectLinkPort,
  folder: WorkspaceFolderRef,
  fields: ProjectLink,
  options: { replace?: { expectedProjectId: unknown } } = {},
): Promise<LinkResult> {
  const file = inFolder(folder, PROJECT_LINK_PATH);
  const parsed = parseProjectLinkText(await port.readText(file));
  if (!parsed.ok) return { status: "refused", reason: parsed.reason };
  const existing = linkOf(parsed.members);
  if (existing && existing.projectId === fields.projectId && existing.projectType === fields.projectType) return { status: "unchanged" };
  if (existing && existing.projectId !== fields.projectId && options.replace?.expectedProjectId !== existing.projectId) return { status: "conflict", existing };
  const text = `${JSON.stringify({ version: 1, ...parsed.members, projectId: fields.projectId, projectType: fields.projectType }, null, 2)}\n`;
  await port.writeText(file, text);
  return { status: "written" };
}
