/**
 * The file actions of the build vocabulary (`canvas_list_build_files`, `canvas_search_build_files`,
 * `canvas_write_build_file`, `canvas_edit_build_file`). Split out of `canvasBuildTools.ts`.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { coerceFileContent, validateFileContentForPath } from '@builderforce/ide-file-contract';
import { createRepoCapabilities, WorkspaceError, type WorkspaceFs } from '@builderforce/agent-tools/workspace';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import { storeWorkspaceFs } from '@/lib/workspace/storeWorkspaceFs';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { workspacePathArg, resolveCanvasBuild, searchWorkspaceFiles, summarizeWorkspace } from '@/lib/canvasBuildContext';
import type { CanvasBuildToolsContext, BuildWorkspaceHelpers } from '@/lib/canvasBuildContext';
import { contentBytes, timeWrite } from '@/lib/browserRuntime/writeTiming';

/**
 * The shared coding provider over one canvas store. The content check is a decorator on the
 * adapter's write, so a write and an edit are both validated before anything is stored, and a
 * refusal comes back through the provider as its error. `stored()` is the exact text the
 * provider wrote (after line-ending conforming), for the history/dependency report.
 */
function canvasProvider(store: WorkspaceFileStore) {
  const base = storeWorkspaceFs(store);
  let stored: string | undefined;
  const fs: WorkspaceFs = {
    ...base,
    write: async (path, content) => {
      const valid = validateFileContentForPath(path, content);
      if (!valid.ok) throw new WorkspaceError('unsupported', valid.reason);
      await base.write(path, content);
    },
  };
  const caps = createRepoCapabilities(fs, { onWrite: (_path, written) => { stored = written?.content; } });
  return { caps, stored: () => stored };
}

/** List, search, write and edit: the actions that work on the files of a Builder object's workspace. */
export function canvasBuildFileActions(ctx: CanvasBuildToolsContext, helpers: BuildWorkspaceHelpers) {
  const { workspaceFiles, committed } = helpers;

  const list: BrainAction = {
    name: 'canvas_list_build_files',
    description: "List every file in a Builder object's workspace, with the exported symbols of each source file. Call this BEFORE writing code so you build on what is already there instead of overwriting it. Excludes node_modules and build output.",
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' } },
    },
    mutates: false,
    run: async (raw: unknown) => {
      const args = raw as { objectId?: unknown };
      const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
      if ('error' in resolved) return resolved;
      try {
        const { files, unreadable } = await workspaceFiles(resolved.build.store);
        return {
          ok: true,
          objectId: resolved.build.objectId,
          modality: resolved.build.modality,
          fileCount: files.length,
          map: summarizeWorkspace(files),
          ...unreadable,
        };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The workspace file list could not be read.') };
      }
    },
  };

  const search: BrainAction = {
    name: 'canvas_search_build_files',
    description: "Find text across a Builder object's workspace — a component name, an import, a string the user wants changed. Returns matching file paths with line numbers. Use it instead of reading every file.",
    parameters: {
      type: 'object', required: ['query'], additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Text to find; a valid regular expression is matched as one, anything else literally. Case-insensitive unless it contains an upper-case letter.' },
        caseSensitive: { type: 'boolean', description: 'Defaults to false.' },
        objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
      },
    },
    mutates: false,
    run: async (raw: unknown) => {
      const args = raw as { query?: unknown; caseSensitive?: unknown; objectId?: unknown };
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query.trim()) return { error: 'A query is required.' };
      const resolved = resolveCanvasBuild(ctx.builds(), args.objectId);
      if ('error' in resolved) return resolved;
      try {
        const { files, unreadable } = await workspaceFiles(resolved.build.store);
        const { matches, truncated } = await searchWorkspaceFiles(files, query, args.caseSensitive === true);
        return {
          ok: true,
          query,
          matchCount: matches.length,
          truncated,
          matches,
          ...unreadable,
        };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The workspace could not be searched.') };
      }
    },
  };

  const write: BrainAction = {
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
      const provider = canvasProvider(resolved.build.store);
      const result = await timeWrite('perFile', { fileCount: 1, totalBytes: contentBytes(content), path, workflowId: String(resolved.build.store.id), taskId: resolved.build.objectId }, () => provider.caps.repoWrite.writeFile(path, content));
      if (!result.ok) return { error: result.error || `"${path}" could not be written.` };
      return { ok: true, applied: true, path, bytes: content.length, ...await committed(resolved.build, path, provider.stored() ?? content) };
    },
  };

  const edit: BrainAction = {
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

      const find = typeof args.find === 'string' ? args.find : '';
      const replace = typeof args.replace === 'string' ? args.replace : '';
      if (!find) return { error: 'find must not be empty. To replace a whole file use canvas_write_build_file.' };
      // The shared provider matches (EOL/escape/whitespace tolerant, literal splices: a `$&` in the
      // replacement is never a capture reference). Only the model-facing wording is the canvas's.
      const provider = canvasProvider(resolved.build.store);
      const result = await timeWrite('perFile', { fileCount: 1, totalBytes: contentBytes(replace), path, workflowId: String(resolved.build.store.id), taskId: resolved.build.objectId }, () => provider.caps.repoWrite.editFile(path, find, replace, args.replaceAll === true));
      if (!result.ok) {
        if (result.code === 'not_found') return { error: `No file "${path}" in this workspace. Use canvas_write_build_file to create it.` };
        if (result.code === 'ambiguous') {
          return { error: `find matched ${result.matchCount} times. Include more surrounding lines so it matches once, or pass replaceAll: true to change every occurrence.` };
        }
        if (result.code === 'no_match') return { error: 'find did not match. Read the file with canvas_read_build_file and copy the exact text, including indentation and line breaks.' };
        return { error: result.error || `"${path}" could not be written.` };
      }
      return { ok: true, applied: true, path, replacements: result.replaced ?? 1, ...await committed(resolved.build, path, provider.stored()) };
    },
  };

  return { list, search, write, edit };
}
