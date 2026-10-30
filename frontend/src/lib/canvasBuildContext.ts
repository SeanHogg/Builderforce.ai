/**
 * The build tools' shared ground: the bound-build and context types, the pure helpers every
 * action leans on (path reading, build resolution, search/replace, the workspace summary) and
 * the workspace helpers a committed change reports through. Split out of `canvasBuildTools.ts`.
 */

import { exportedSymbols } from '@builderforce/agent-tools/symbols';
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

/** Match cap for one `canvas_search_build_files` call. */
export const MAX_SEARCH_MATCHES = 100;

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
 * Apply a search/replace edit to a file body.
 *
 * Exported and pure so the edit contract is testable on its own. Returns a
 * `reason` rather than throwing for the two cases the MODEL must be able to
 * recover from — the anchor is absent, or it is ambiguous — because both are
 * answerable by reading the file again, and a thrown error would just end the
 * turn.
 */
export function applySearchReplace(
  source: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): { ok: true; next: string; replacements: number } | { ok: false; reason: string } {
  if (!find) return { ok: false, reason: 'find must not be empty. To replace a whole file use canvas_write_build_file.' };
  const occurrences = source.split(find).length - 1;
  if (occurrences === 0) {
    return { ok: false, reason: 'find did not match. Read the file with canvas_read_build_file and copy the exact text, including indentation and line breaks.' };
  }
  if (occurrences > 1 && !replaceAll) {
    return { ok: false, reason: `find matched ${occurrences} times. Include more surrounding lines so it matches once, or pass replaceAll: true to change every occurrence.` };
  }
  // Index arithmetic, NOT `String.replace`: `replace` interprets `$&`, `$1` and
  // `$'` in the REPLACEMENT as capture references, so a model writing a price
  // string, a regex literal or a template would get silently mangled text back.
  // Both branches are literal.
  const next = replaceAll
    ? source.split(find).join(replace)
    : (() => {
      const at = source.indexOf(find);
      return source.slice(0, at) + replace + source.slice(at + find.length);
    })();
  return { ok: true, next, replacements: replaceAll ? occurrences : 1 };
}

/**
 * Find `query` in a file's text, returning the matching lines with their numbers.
 *
 * Plain substring matching, deliberately: a model that wants a regex can ask for
 * a distinctive literal instead, and a bad regex from a model is a hang rather
 * than a miss.
 */
export function searchFileLines(
  path: string,
  content: string,
  query: string,
  caseSensitive: boolean,
): { path: string; line: number; text: string }[] {
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: { path: string; line: number; text: string }[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const haystack = caseSensitive ? line : line.toLowerCase();
    if (haystack.includes(needle)) {
      out.push({ path, line: index + 1, text: line.trim().slice(0, 300) });
    }
  }
  return out;
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
