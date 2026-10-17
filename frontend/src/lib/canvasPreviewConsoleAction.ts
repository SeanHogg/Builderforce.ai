/**
 * `canvas_read_preview_console` — what a Builder object's running preview printed to
 * its console, for the agent: the same record the person reads in the workspace's
 * Console tab (`lib/previewConsole.ts`, fed by the runtime through
 * `lib/browserRuntime/previewSignals.ts`).
 *
 * `canvas_read_build_diagnostics` answers "what broke"; this answers "what did the app
 * say" — the warning React printed, the value a `console.log` showed, the failed fetch an
 * app caught and logged instead of throwing.
 *
 * Its own module so `canvasBuildTools.ts` grows by one spread, not another tool body
 * (as `canvasBuildCommandAction.ts`).
 */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import type { BoundCanvasBuild } from '@/lib/canvasBuildTools';
import { formatConsoleEntry, matchesConsoleFilter, readConsoleEntries, type ConsoleFilter } from '@/lib/previewConsole';

/** Lines returned when the call names no limit. */
export const DEFAULT_CONSOLE_LINES = 100;

/** The most a call may ask for — the store keeps 500. */
const MAX_CONSOLE_LINES = 500;

const LEVELS: readonly ConsoleFilter[] = ['all', 'errors', 'warnings', 'info'];

function levelArg(value: unknown): ConsoleFilter {
  return LEVELS.includes(value as ConsoleFilter) ? value as ConsoleFilter : 'all';
}

function limitArg(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_CONSOLE_LINES) : DEFAULT_CONSOLE_LINES;
}

/**
 * The canvas BrainAction. `resolve` is `resolveCanvasBuild` bound to the board's builds,
 * injected so this module and `canvasBuildTools.ts` do not import each other's values.
 */
export function canvasReadPreviewConsoleAction(
  resolve: (objectId: unknown) => { build: BoundCanvasBuild } | { error: string },
): BrainAction {
  return {
    name: 'canvas_read_preview_console',
    description: "Read what a Builder object's live preview printed to its browser console since it last ran — console.log/info/warn/error/debug from every page the preview served, newest last, repeated lines collapsed with a count. Use it to see what the app reports about itself (React warnings, logged values, caught failures); for errors that broke the build or crashed the app, use canvas_read_build_diagnostics.",
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        level: { type: 'string', enum: [...LEVELS], description: 'Only errors, warnings, or info (log/info/debug). Default all.' },
        limit: { type: 'number', description: `Most recent lines to return. Default ${DEFAULT_CONSOLE_LINES}, at most ${MAX_CONSOLE_LINES}.` },
        objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
      },
    },
    run: async (raw: unknown) => {
      const args = (raw ?? {}) as { level?: unknown; limit?: unknown; objectId?: unknown };
      const resolved = resolve(args.objectId);
      if ('error' in resolved) return resolved;
      const level = levelArg(args.level);
      const matching = readConsoleEntries(resolved.build.store.id).filter((entry) => matchesConsoleFilter(entry.level, level));
      if (matching.length === 0) {
        return {
          ok: true,
          lines: 0,
          note: level === 'all'
            ? 'The preview has printed nothing to its console since it last ran — or it has not run yet in this session.'
            : `No ${level} in the preview console since it last ran.`,
        };
      }
      const recent = matching.slice(-limitArg(args.limit));
      return {
        ok: true,
        lines: recent.length,
        ...(recent.length < matching.length ? { omitted: matching.length - recent.length } : {}),
        console: recent.map(formatConsoleEntry).join('\n'),
      };
    },
  };
}
