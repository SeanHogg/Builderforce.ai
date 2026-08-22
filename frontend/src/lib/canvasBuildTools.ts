/**
 * The canvas's BUILD vocabulary — creating, reading, searching and editing the
 * code behind a Builder object, from the board.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * The canvas advertised 60 `canvas_*` tools and not one of them touched a file,
 * a build, or a line of code. The code actions (`create_file`,
 * `apply_code_to_active_file`) were registered by `<BuilderWorkspace>` itself,
 * so they existed ONLY while a Builder panel happened to be open on a bound
 * project. "Build me an app", typed at the canvas prompt — the front door — had
 * no path to code at all unless the person already knew to create a Builder
 * object and open it first.
 *
 * Worse, the two actions that did exist were blind and blunt: no list, no read,
 * no search, and every write was a WHOLE FILE. The model's entire view of a
 * project was the open file, truncated to 4 000 characters, so the second prompt
 * against a multi-file app was authored without knowledge of what the first one
 * had built.
 *
 * ── WHY THESE NAMES ─────────────────────────────────────────────────────────
 * `list_files` / `read_file` / `search_code` / `write_file` / `edit_file` is the
 * vocabulary the CLOUD runner already advertises (`cloudAgentTools.ts`, under
 * `repo.read` / `repo.search` / `repo.write` / `repo.edit`), and it is a good
 * vocabulary — models are fluent in it. These are the same verbs behind the
 * `canvas_` prefix every canvas tool carries, so one model reads one set of
 * habits across both surfaces. The prefix is not decoration: the guest boundary
 * in `packages/creation-canvas-contract` is drawn over `canvas_*` names, and a
 * tool that reaches a tenant's workspace must be classifiable there.
 *
 * ── WHY A MODULE AND NOT MORE OF CreationCanvas.tsx ─────────────────────────
 * The canvas component is already ~9 700 lines with one ~3 700-line `useMemo`
 * holding every action inline. Adding seven more there would be the cheapest
 * thing to write and the most expensive thing to own. These are pure functions
 * over an injected context, so they are unit-testable without React, a canvas,
 * or a WebContainer.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * Every write goes through {@link validateFileContentForPath}, the SAME guard
 * the workspace's own editor uses. A model writing CSS into `package.json` broke
 * Run in a way that took a long time to diagnose; there is exactly one place
 * that decision is made and this is not a second one.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { fetchFiles, fetchFileContent, fetchFileHistory, restoreFileVersion, saveFile } from '@/lib/api';
import { coerceFileContent, validateFileContentForPath } from '@builderforce/ide-file-contract';
import { formatBuildFailures } from '@/lib/buildDiagnostics';
import { MODALITIES, type ProjectModality } from '@/lib/modality';
import type { CanvasBuildBinding } from '@/lib/canvasBuild';

/** A Builder object on the board that has a workspace behind it. */
export interface BoundCanvasBuild {
  /** Canvas object id. */
  objectId: string;
  title: string;
  binding: CanvasBuildBinding;
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
  onFilesChanged?: (storageProjectId: number, paths: string[]) => void;
}

/** Modalities that have a code workspace. The generative studios do not. */
const BUILDABLE_MODALITIES: ProjectModality[] = ['designer', 'mobile', 'webmobile'];

/** Files whose content is never useful to a model and costly to page through. */
const SKIP_DIRECTORIES = ['node_modules/', 'dist/', '.git/'];

/** Read cap for one `canvas_read_build_file` call. */
export const MAX_READ_CHARS = 100_000;

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

function isSkipped(path: string): boolean {
  return SKIP_DIRECTORIES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix) || path.includes(`/${prefix}`));
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

const EXPORT_PATTERNS = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
];

/** Exported names of a JS/TS source file. Empty for anything else. */
export function exportedSymbols(path: string, content: string): string[] {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(path)) return [];
  const found = new Set<string>();
  for (const pattern of EXPORT_PATTERNS) {
    // A fresh regex per file: a shared /g regex carries lastIndex between calls.
    const re = new RegExp(pattern.source, pattern.flags);
    let match = re.exec(content);
    while (match) {
      found.add(match[1]);
      match = re.exec(content);
    }
  }
  if (/\bexport\s+default\b/.test(content)) found.add('default');
  return [...found].slice(0, 25);
}

/**
 * The canvas's build actions.
 *
 * Every one resolves its target build through {@link resolveCanvasBuild}, so the
 * "which build?" answer cannot differ between tools, and every write revalidates
 * through the shared content guard.
 */
export function canvasBuildActions(ctx: CanvasBuildToolsContext): BrainAction[] {
  /** Files worth showing a model: the workspace minus build output and deps. */
  const workspaceFiles = async (storageProjectId: number) => {
    const entries = await fetchFiles(storageProjectId);
    return entries.filter((entry) => entry.type !== 'directory' && !isSkipped(entry.path));
  };

  return [
    {
      name: 'canvas_create_build',
      description: 'Create a real, runnable code workspace on this board and return its Builder object. Use this the moment the user asks for a website, a web app, or a mobile app — it provisions a seeded starter project (Vite + React for a website, React Native for mobile) that runs in the browser preview and can be published to a real URL. After it returns, author the app with canvas_write_build_file / canvas_edit_build_file. Do NOT describe an app in a document object when the user asked for a working one.',
      mutates: true,
      parameters: {
        type: 'object', required: ['title', 'modality'], additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Short product name, e.g. "Recipe Box".' },
          modality: {
            type: 'string',
            enum: BUILDABLE_MODALITIES,
            description: 'designer = a website or web app; mobile = a React Native phone app; webmobile = one codebase that is both.',
          },
        },
      },
      run: async (raw: unknown) => {
        const args = raw as { title?: unknown; modality?: unknown };
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        if (!title) return { error: 'A title is required.' };
        const modality = BUILDABLE_MODALITIES.includes(args.modality as ProjectModality)
          ? args.modality as ProjectModality
          : 'designer';
        try {
          const build = await ctx.createBuild({ title, modality });
          const files = await workspaceFiles(build.binding.storageProjectId).catch(() => []);
          return {
            ok: true,
            object: { id: build.objectId, kind: 'build', title: build.title },
            modality,
            files: files.map((file) => file.path),
            next: 'The workspace is seeded and runnable. Edit the starter files with canvas_edit_build_file (or canvas_write_build_file for a new file) to build what the user asked for.',
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'The workspace could not be created.' };
        }
      },
    },
    {
      name: 'canvas_list_build_files',
      description: "List every file in a Builder object's workspace, with the exported symbols of each source file. Call this BEFORE writing code so you build on what is already there instead of overwriting it. Excludes node_modules and build output.",
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' } },
      },
      run: async (raw: unknown) => {
        const args = raw as { objectId?: unknown };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;
        try {
          const files = await workspaceFiles(resolved.build.binding.storageProjectId);
          return {
            ok: true,
            objectId: resolved.build.objectId,
            modality: resolved.build.binding.modality,
            fileCount: files.length,
            map: summarizeWorkspace(files),
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'The workspace file list could not be read.' };
        }
      },
    },
    {
      name: 'canvas_read_build_file',
      description: "Read one file from a Builder object's workspace. Always read a file before editing it — canvas_edit_build_file needs the exact existing text to anchor against.",
      parameters: {
        type: 'object', required: ['path'], additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Workspace-relative path, e.g. src/App.jsx' },
          objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
        },
      },
      run: async (raw: unknown) => {
        const args = raw as { path?: unknown; objectId?: unknown };
        const path = workspacePathArg(args.path);
        if (!path) return { error: 'A path is required.' };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;
        try {
          const content = await fetchFileContent(resolved.build.binding.storageProjectId, path);
          return {
            ok: true,
            path,
            content: content.slice(0, MAX_READ_CHARS),
            truncated: content.length > MAX_READ_CHARS,
          };
        } catch {
          return { error: `No file "${path}" in this workspace. Call canvas_list_build_files to see what is there.` };
        }
      },
    },
    {
      name: 'canvas_search_build_files',
      description: "Find text across a Builder object's workspace — a component name, an import, a string the user wants changed. Returns matching file paths with line numbers. Use it instead of reading every file.",
      parameters: {
        type: 'object', required: ['query'], additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Literal text to find. Not a regular expression.' },
          caseSensitive: { type: 'boolean', description: 'Defaults to false.' },
          objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
        },
      },
      run: async (raw: unknown) => {
        const args = raw as { query?: unknown; caseSensitive?: unknown; objectId?: unknown };
        const query = typeof args.query === 'string' ? args.query : '';
        if (!query.trim()) return { error: 'A query is required.' };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;
        try {
          const files = await workspaceFiles(resolved.build.binding.storageProjectId);
          const matches: { path: string; line: number; text: string }[] = [];
          for (const file of files) {
            matches.push(...searchFileLines(file.path, file.content, query, args.caseSensitive === true));
            if (matches.length >= MAX_SEARCH_MATCHES) break;
          }
          return {
            ok: true,
            query,
            matchCount: matches.length,
            truncated: matches.length >= MAX_SEARCH_MATCHES,
            matches: matches.slice(0, MAX_SEARCH_MATCHES),
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'The workspace could not be searched.' };
        }
      },
    },
    {
      name: 'canvas_write_build_file',
      description: "Create a file, or replace one entirely, in a Builder object's workspace. Use this for a NEW file. To change part of a file that already exists, use canvas_edit_build_file instead — a whole-file rewrite silently drops anything you did not reproduce.",
      mutates: true,
      parameters: {
        type: 'object', required: ['path', 'content'], additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Workspace-relative path, e.g. src/components/Header.jsx' },
          content: { type: 'string', description: 'Complete file contents.' },
          objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
        },
      },
      run: async (raw: unknown) => {
        const args = raw as { path?: unknown; content?: unknown; objectId?: unknown };
        const path = workspacePathArg(args.path);
        if (!path) return { error: 'A path is required.' };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;
        // Models emit structured bodies (package.json especially) as objects.
        const content = coerceFileContent(args.content);
        const valid = validateFileContentForPath(path, content);
        if (!valid.ok) return { error: valid.reason };
        try {
          await saveFile(resolved.build.binding.storageProjectId, path, content);
          ctx.onFilesChanged?.(resolved.build.binding.storageProjectId, [path]);
          return { ok: true, path, bytes: content.length };
        } catch (error) {
          return { error: error instanceof Error ? error.message : `"${path}" could not be written.` };
        }
      },
    },
    {
      name: 'canvas_edit_build_file',
      description: "Change part of an existing file in a Builder object's workspace by replacing exact text. This is the tool to use for almost every change to a file that already exists: it costs a fraction of a rewrite and cannot drop code you did not mention. Read the file first and copy the anchor text exactly.",
      mutates: true,
      parameters: {
        type: 'object', required: ['path', 'find', 'replace'], additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Workspace-relative path.' },
          find: { type: 'string', description: 'Exact existing text, including indentation. Must match once unless replaceAll is true.' },
          replace: { type: 'string', description: 'Replacement text. Empty string deletes the matched text.' },
          replaceAll: { type: 'boolean', description: 'Replace every occurrence. Defaults to false.' },
          objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
        },
      },
      run: async (raw: unknown) => {
        const args = raw as { path?: unknown; find?: unknown; replace?: unknown; replaceAll?: unknown; objectId?: unknown };
        const path = workspacePathArg(args.path);
        if (!path) return { error: 'A path is required.' };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;

        let source: string;
        try {
          source = await fetchFileContent(resolved.build.binding.storageProjectId, path);
        } catch {
          return { error: `No file "${path}" in this workspace. Use canvas_write_build_file to create it.` };
        }
        const edit = applySearchReplace(
          source,
          typeof args.find === 'string' ? args.find : '',
          typeof args.replace === 'string' ? args.replace : '',
          args.replaceAll === true,
        );
        if (!edit.ok) return { error: edit.reason };
        const valid = validateFileContentForPath(path, edit.next);
        if (!valid.ok) return { error: valid.reason };
        try {
          await saveFile(resolved.build.binding.storageProjectId, path, edit.next);
          ctx.onFilesChanged?.(resolved.build.binding.storageProjectId, [path]);
          return { ok: true, path, replacements: edit.replacements };
        } catch (error) {
          return { error: error instanceof Error ? error.message : `"${path}" could not be written.` };
        }
      },
    },
    {
      name: 'canvas_read_build_diagnostics',
      description: "Read the build and runtime errors a Builder object's workspace produced the last time it ran — failed installs, failed builds, and errors thrown inside the live preview. Call this when the user says the app is broken, blank, or not working, BEFORE guessing at a cause.",
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' } },
      },
      run: async (raw: unknown) => {
        const args = raw as { objectId?: unknown };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;
        const report = formatBuildFailures(resolved.build.binding.storageProjectId);
        if (!report) {
          return {
            ok: true,
            failures: 0,
            note: 'No build or runtime errors have been recorded for this workspace in this session. If the user reports a problem, it has not run yet — open the Builder object and press Run — or the problem is behavioural rather than an error.',
          };
        }
        return { ok: true, failures: report.split('\n\n---\n\n').length, report };
      },
    },
    {
      name: 'canvas_list_build_file_history',
      description: "List the earlier versions of files in a Builder object's workspace, newest first. Every write archives the version it replaced, so this is what a change can be undone back to. Omit path to see everything that changed recently — which is how you find what the last few edits touched.",
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Narrow to one file. Omit for the whole workspace.' },
          objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
        },
      },
      run: async (raw: unknown) => {
        const args = raw as { path?: unknown; objectId?: unknown };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;
        try {
          const versions = await fetchFileHistory(
            resolved.build.binding.storageProjectId,
            workspacePathArg(args.path) || undefined,
          );
          return {
            ok: true,
            versions: versions.map((version) => ({
              path: version.path,
              at: version.at,
              replacedAt: new Date(version.at).toISOString(),
              size: version.size,
            })),
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'The file history could not be read.' };
        }
      },
    },
    {
      name: 'canvas_restore_build_file',
      description: "Put an earlier version of a file back — the undo. Use this the moment the user says a change broke something or asks to revert: it is instant, it is exact, and it is far better than trying to reconstruct the previous code from memory. Get the `at` value from canvas_list_build_file_history. The restore is itself archived, so it can be undone again.",
      mutates: true,
      parameters: {
        type: 'object', required: ['path', 'at'], additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Workspace-relative path.' },
          at: { type: 'number', description: 'The version stamp from canvas_list_build_file_history.' },
          objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
        },
      },
      run: async (raw: unknown) => {
        const args = raw as { path?: unknown; at?: unknown; objectId?: unknown };
        const path = workspacePathArg(args.path);
        const at = Number(args.at);
        if (!path || !Number.isFinite(at)) return { error: 'path and at are both required. Call canvas_list_build_file_history first.' };
        const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
        if ('error' in resolved) return resolved;
        try {
          await restoreFileVersion(resolved.build.binding.storageProjectId, path, at);
          ctx.onFilesChanged?.(resolved.build.binding.storageProjectId, [path]);
          return { ok: true, path, restoredFrom: new Date(at).toISOString() };
        } catch (error) {
          return { error: error instanceof Error ? error.message : `"${path}" could not be restored.` };
        }
      },
    },
  ];
}

/** Every tool name this module contributes. Used by the guest-boundary contract. */
export const CANVAS_BUILD_TOOL_NAMES = [
  'canvas_create_build',
  'canvas_list_build_files',
  'canvas_read_build_file',
  'canvas_search_build_files',
  'canvas_write_build_file',
  'canvas_edit_build_file',
  'canvas_read_build_diagnostics',
  'canvas_list_build_file_history',
  'canvas_restore_build_file',
] as const;

/** Modality ids a Builder object can be created with, for the UI that offers them. */
export const CANVAS_BUILDABLE_MODALITIES = BUILDABLE_MODALITIES;

/** Label for a buildable modality, from the modality registry (never re-typed here). */
export function buildableModalityLabel(id: ProjectModality): string {
  return MODALITIES.find((modality) => modality.id === id)?.label ?? id;
}
