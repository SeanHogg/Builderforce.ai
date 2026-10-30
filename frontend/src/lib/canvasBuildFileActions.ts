/**
 * The file actions of the build vocabulary (`canvas_list_build_files`, `canvas_search_build_files`,
 * `canvas_write_build_file`, `canvas_edit_build_file`). Split out of `canvasBuildTools.ts`.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { coerceFileContent, validateFileContentForPath } from '@builderforce/ide-file-contract';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { MAX_SEARCH_MATCHES, workspacePathArg, resolveCanvasBuild, applySearchReplace, searchFileLines, summarizeWorkspace } from '@/lib/canvasBuildContext';
import type { CanvasBuildToolsContext, BuildWorkspaceHelpers } from '@/lib/canvasBuildContext';

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
        const { files, unreadable } = await workspaceFiles(resolved.build.store);
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
      const valid = validateFileContentForPath(path, content);
      if (!valid.ok) return { error: valid.reason };
      try {
        await resolved.build.store.write(path, content);
        return { ok: true, applied: true, path, bytes: content.length, ...await committed(resolved.build, path, content) };
      } catch (error) {
        return { error: toolErrorMessage(error, `"${path}" could not be written.`) };
      }
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

      let source: string;
      try {
        source = await resolved.build.store.read(path);
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
        await resolved.build.store.write(path, edit.next);
        return { ok: true, applied: true, path, replacements: edit.replacements, ...await committed(resolved.build, path, edit.next) };
      } catch (error) {
        return { error: toolErrorMessage(error, `"${path}" could not be written.`) };
      }
    },
  };

  return { list, search, write, edit };
}
