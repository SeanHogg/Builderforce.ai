/**
 * The diagnostics and history actions of the build vocabulary (`canvas_read_build_diagnostics`,
 * `canvas_list_build_file_history`, `canvas_restore_build_file`). Split out of `canvasBuildTools.ts`.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { formatBuildFailures } from '@/lib/buildDiagnostics';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { NO_HISTORY, workspacePathArg, resolveCanvasBuild } from '@/lib/canvasBuildContext';
import type { CanvasBuildToolsContext, BuildWorkspaceHelpers } from '@/lib/canvasBuildContext';

/** Diagnostics, file history and restore: what the workspace did, and undoing it. */
export function canvasBuildHistoryActions(ctx: CanvasBuildToolsContext, helpers: BuildWorkspaceHelpers) {
  const { committed } = helpers;

  const diagnostics: BrainAction = {
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
      const { current, stale } = formatBuildFailures(resolved.build.store.id);
      if (!current.report && !stale.report) {
        return {
          ok: true,
          failures: 0,
          note: 'No build or runtime errors have been recorded for this workspace in this session. If the user reports a problem, it has not run yet — open the Builder object and press Run — or the problem is behavioural rather than an error.',
        };
      }
      // Errors last seen BEFORE the latest edit are not evidence the edit failed:
      // the preview has not reported them again. Re-writing the same file over
      // them is the loop this split exists to stop.
      const staleNote = stale.report
        ? `${stale.count} error(s) were last seen BEFORE the latest file change and have not recurred since. Do not rewrite a file to fix them again — if the preview has reloaded and they are absent, the edit worked; otherwise ask the user to reload the preview and re-read.`
        : undefined;
      return {
        ok: true,
        failures: current.count,
        ...(current.report ? { report: current.report } : {}),
        ...(stale.report ? { staleFailures: stale.count, staleReport: stale.report, note: staleNote } : {}),
      };
    },
  };

  const history: BrainAction = {
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
      const { history } = resolved.build.store;
      if (!history) return { error: NO_HISTORY };
      try {
        const versions = await history(workspacePathArg(args.path) || undefined);
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
        return { error: toolErrorMessage(error, 'The file history could not be read.') };
      }
    },
  };

  const restoreFile: BrainAction = {
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
      const { restore } = resolved.build.store;
      if (!restore) return { error: NO_HISTORY };
      try {
        await restore(path, at);
        await committed(resolved.build, path);
        return { ok: true, applied: true, path, restoredFrom: new Date(at).toISOString() };
      } catch (error) {
        return { error: toolErrorMessage(error, `"${path}" could not be restored.`) };
      }
    },
  };

  return [diagnostics, history, restoreFile];
}
