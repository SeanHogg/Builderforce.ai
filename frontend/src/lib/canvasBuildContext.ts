/**
 * The build tools' shared ground: the bound-build and context types, the pure helpers every
 * action leans on (path reading, build resolution, the workspace summary) and
 * the workspace helpers a committed change reports through. Split out of `canvasBuildTools.ts`.
 */

import { exportedSymbols } from '@builderforce/agent-tools/symbols';
import { memoryWorkspaceFs } from '@builderforce/agent-tools/memory-workspace-fs';
import { MATCH_TEXT_MAX, compileSearchPattern, scanFiles, type SearchMatch } from '@builderforce/agent-tools/text-scan';
import { MODALITIES, type ProjectModality } from '@/lib/modality';
import { type WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import { readStoreFiles } from '@/lib/workspace/readStoreFiles';
import { isGeneratedPath } from '@/lib/workspace/generatedPaths';
import { type WorkspaceId } from '@/lib/workspace/workspaceId';
import { undeclaredDependencies } from '@/lib/undeclaredDependencies';

/** A Builder object on the board that has a workspace behind it. */
export interface BoundCanvasBuild {
  /** Canvas object id. */
  objectId: string;
  title: string;
  modality: ProjectModality;
  /**
   * Where its files live: the durable storage project, or — for a board with no account
   * yet — this browser. Every tool reads and writes through it, so the same vocabulary
   * builds a guest's app and a tenant's.
   */
  store: WorkspaceFileStore;
}

export interface CanvasBuildToolsContext {
  /**
   * Builder objects on the board that are BOUND to a workspace, committed and
   * staged alike. A function rather than a value so the actions read current
   * state without the array having to be a `useMemo` dependency that
   * re-registers every tool on every board change.
   */
  builds: () => BoundCanvasBuild[];
  /**
   * Provision a workspace and put the Builder object on the board. Returns the
   * bound object, so `canvas_create_build` can hand the model something it can
   * immediately write files into.
   *
   * Injected because provisioning is the canvas's own concern: it owns node
   * placement, the container-project edge, and the account gate.
   */
  createBuild: (input: { title: string; modality: ProjectModality }) => Promise<BoundCanvasBuild>;
  /**
   * Tell the host a file changed underneath it, so an open workspace panel
   * re-reads it instead of showing a stale editor buffer over new content.
   */
  onFilesChanged?: (workspaceId: WorkspaceId, paths: string[]) => void;
  /**
   * Tell the host the Brain wrote into this Builder object, so the surface can show the
   * app being built (`writtenAppTakesPrimary`) rather than one beside it.
   */
  onBuildWritten?: (objectId: string) => void;
}

/**
 * Modalities that have a code workspace. The generative studios do not — and these are also
 * the only ones a workspace held in this browser can run, since the studios need a project.
 */
export const BUILDABLE_MODALITIES: readonly ProjectModality[] = ['designer', 'mobile', 'webmobile'];

/** True for a modality with a code workspace, so one that can also run held in this browser. */
export function hasCodeWorkspace(modality: unknown): modality is ProjectModality {
  return BUILDABLE_MODALITIES.includes(modality as ProjectModality);
}

/**
 * The modality an app is actually created with. A durable project can be any type; a
 * workspace held in this browser (and the Brain's create tool) only one with code, and
 * falls back to a website rather than refusing.
 */
export function appModalityFor(modality: unknown, durable: boolean): ProjectModality {
  if (hasCodeWorkspace(modality)) return modality;
  return durable && typeof modality === 'string' && MODALITIES.some((entry) => entry.id === modality)
    ? modality as ProjectModality
    : 'designer';
}

/** What the history tools answer for a workspace held in this browser, which keeps none. */
export const NO_HISTORY = 'This workspace is held in this browser and keeps no file history yet. Saving the board to an account turns on history and restore.';

/**
 * The one reading of a model-supplied `path` argument.
 *
 * Models write a workspace path the way they would write it in an editor —
 * `/src/App.jsx`, `./src/App.jsx`, occasionally `src\App.jsx`. The workspace
 * addresses files relative to its root, so those are the SAME file, and a turn
 * that retries a failed write with a leading slash (as one did) must not fail
 * twice for a reason the model cannot see. Normalising here, once, is what makes
 * every build tool agree on what a path is.
 *
 * `..` is deliberately left alone: escaping the workspace is the server
 * validator's call to refuse, not something to quietly rewrite into a real path.
 */
export function workspacePathArg(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\\/g, '/')        // a Windows-style path names the same file
    .replace(/\/{2,}/g, '/')    // `src//App.jsx` is `src/App.jsx`
    .replace(/^(?:\.\/)+/, '')  // `./src/App.jsx` is relative already
    .replace(/^\/+/, '');       // `/src/App.jsx` is workspace-relative, not absolute
}

/**
 * Resolve which build a tool call is about.
 *
 * Shared by every file tool because the disambiguation rule has to be identical
 * across them: an explicit `objectId` wins; otherwise a board with exactly one
 * bound build needs no argument at all (the overwhelmingly common case); a board
 * with several returns the list so the model can choose rather than guess.
 */
export function resolveCanvasBuild(
  builds: BoundCanvasBuild[],
  objectId?: unknown,
): { build: BoundCanvasBuild } | { error: string } {
  if (!builds.length) {
    return { error: 'This board has no Builder object with a workspace behind it. Call canvas_create_build first — it provisions a runnable starter project and puts the Builder object on the board.' };
  }
  if (typeof objectId === 'string' && objectId.trim()) {
    const found = builds.find((candidate) => candidate.objectId === objectId.trim());
    if (found) return { build: found };
    return { error: `No Builder object "${objectId}" on this board. Builder objects here: ${builds.map((b) => `${b.objectId} (${b.title})`).join(', ')}.` };
  }
  if (builds.length === 1) return { build: builds[0] };
  return { error: `This board has several Builder objects — pass objectId to say which: ${builds.map((b) => `${b.objectId} (${b.title})`).join(', ')}.` };
}

/**
 * Find `query` across the workspace files: the shared line scanner over the files held in
 * memory (the same one the editor and the cloud search with), so a match, its cap and its
 * `truncated` flag read the same everywhere. The query is a regular expression when it is
 * one, else literal text. Smart case unless `caseSensitive` is asked for explicitly.
 */
export async function searchWorkspaceFiles(
  files: { path: string; content: string }[],
  query: string,
  caseSensitive: boolean,
): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
  const fs = memoryWorkspaceFs(new Map(files.map((file) => [file.path, file.content])));
  const pattern = compileSearchPattern(query, true);
  const result = await scanFiles(fs, query, '', {
    // Every workspace file is searchable, whatever its directory is called.
    dirFilter: () => true,
    ...(caseSensitive
      ? {
          lineMatcher: (path: string, text: string, line: number): SearchMatch[] =>
            pattern.test(text) ? [{ path, line, text: text.trim().slice(0, MATCH_TEXT_MAX) }] : [],
        }
      : {}),
  });
  if (!result.ok) return { matches: [], truncated: false };
  return {
    matches: (result.matches ?? []).map((match) => ({ path: match.path as string, line: match.line as number, text: match.text as string })),
    truncated: result.truncated === true,
  };
}

/**
 * A compact map of what is in the workspace: every path, plus the exported
 * symbols of each source file.
 *
 * This is what replaces "the open file, truncated to 4 000 characters" as the
 * model's view of a project. Exports are the right summary because they are what
 * one file needs to know about another — the thing a second prompt gets wrong
 * when it cannot see the first prompt's work.
 */
export function summarizeWorkspace(files: { path: string; content: string }[]): string {
  const lines: string[] = [];
  for (const file of files) {
    const exported = exportedSymbols(file.path, file.content);
    lines.push(exported.length ? `${file.path} — exports: ${exported.join(', ')}` : file.path);
  }
  return lines.join('\n');
}

/** What every build action shares: the workspace's paths and files, and the report of a committed change. */
export function buildWorkspaceHelpers(ctx: CanvasBuildToolsContext) {
  /** Paths worth showing a model: the workspace minus build output and deps. */
  const workspacePaths = async (store: WorkspaceFileStore) => {
    const entries = await store.list();
    return entries.filter((entry) => entry.type !== 'directory' && !isGeneratedPath(entry.path)).map((entry) => entry.path);
  };
  /** Those files WITH their content — a durable store lists paths only, so they are read. */
  const workspaceFiles = async (store: WorkspaceFileStore) => {
    const { files, unreadable } = await readStoreFiles(store, (path) => !isGeneratedPath(path));
    return {
      files: Object.entries(files).map(([path, content]) => ({ path, content })),
      /** Spread into a tool result so the model knows a listed file was not seen. */
      unreadable: unreadable.length ? { unreadableFiles: unreadable } : {},
    };
  };
  /** Every committed file change reports through here: the open editor re-reads, the
   *  host learns which app is being built, and a source file that imports a package the
   *  manifest does not declare says so (`undeclaredDependencies`) — the preview's
   *  `npm install` would otherwise leave that import unresolvable. */
  const committed = async (build: BoundCanvasBuild, path: string, content?: string) => {
    ctx.onFilesChanged?.(build.store.id, [path]);
    ctx.onBuildWritten?.(build.objectId);
    if (content === undefined) return {};
    const manifest = await build.store.read('package.json').catch(() => null);
    const missing = undeclaredDependencies(path, content, manifest);
    return missing.length
      ? { undeclaredDependencies: missing, next: `Add ${missing.join(', ')} to package.json "dependencies" with canvas_edit_build_file — the preview installs only what package.json declares, so these imports cannot resolve until you do.` }
      : {};
  };
  return { workspacePaths, workspaceFiles, committed };
}

export type BuildWorkspaceHelpers = ReturnType<typeof buildWorkspaceHelpers>;
