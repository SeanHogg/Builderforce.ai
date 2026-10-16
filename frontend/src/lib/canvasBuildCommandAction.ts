/**
 * `canvas_run_build_command` — the build vocabulary's shell: install, build, type-check
 * and test a Builder object's app in the browser's own Node runtime.
 *
 * NOT a second definition of the tool. It is the shared `run_command`
 * (`@builderforce/agent-tools`, the one the VS Code extension and the cloud Container
 * advertise) adapted to a BrainAction: its description and `execute` are reused as-is,
 * and only the shell behind `ctx.caps.shell` differs — {@link createWorkspaceShell},
 * the in-browser runtime over the build's store. The `canvas_` name and `objectId`
 * argument are what every build tool carries (see `canvasBuildTools.ts`, WHY THESE NAMES).
 *
 * Its own module so `canvasBuildTools.ts` grows by one spread, not another tool body.
 */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { runCommandTool, type Capability } from '@builderforce/agent-tools';
import { createWorkspaceShell } from '@/lib/browserRuntime/workspaceShell';
import type { BoundCanvasBuild, CanvasBuildToolsContext } from '@/lib/canvasBuildTools';
import { toolErrorMessage } from '@/lib/toolErrorMessage';

const SHARED = runCommandTool.schema.function;

/** The shared tool's own description of its one argument. */
const COMMAND_PARAMETER = (SHARED.parameters.properties as { command: Record<string, unknown> }).command;

/**
 * The shared description, re-pointed at this surface: it was written for a checked-out
 * repository and a run that ends in `finish`; here it is a Builder object's workspace and
 * a turn that ends by telling the person. A phrase that no longer matches upstream is
 * left as written rather than failing — the sentence after it says where this runs.
 */
const SHARED_DESCRIPTION = SHARED.description
  .replace('in the checked-out repository (real shell)', "in a Builder object's workspace")
  .replace('BEFORE calling finish', 'BEFORE telling the user it works');

/**
 * The canvas BrainAction. `resolve` is `resolveCanvasBuild` bound to the board's builds,
 * injected rather than imported so this module and `canvasBuildTools.ts` (which spreads
 * this action in) do not import each other's values.
 */
export function canvasRunBuildCommandAction(
  ctx: Pick<CanvasBuildToolsContext, 'onFilesChanged' | 'onBuildWritten'>,
  resolve: (objectId: unknown) => { build: BoundCanvasBuild } | { error: string },
): BrainAction {
  return {
    name: 'canvas_run_build_command',
    description: `${SHARED_DESCRIPTION} It runs in this browser's own Node runtime against the build's current files — npm, node, npx and the usual shell built-ins, pipes and && work; native addons and system binaries do not. Files the command creates, changes or deletes are saved back to the workspace (dependencies and build output are not). Do NOT start a long-running server or watcher (npm run dev, vite): it never exits and is stopped at the timeout — the live preview already runs the app; use canvas_read_build_diagnostics for its errors.`,
    mutates: true,
    parameters: {
      type: 'object', required: ['command'], additionalProperties: false,
      properties: {
        command: COMMAND_PARAMETER,
        objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
      },
    },
    run: async (raw: unknown) => {
      const args = raw as { command?: unknown; objectId?: unknown };
      const resolved = resolve(args.objectId);
      if ('error' in resolved) return resolved;
      const { build } = resolved;
      const shell = createWorkspaceShell(build.store, {
        onFilesChanged: (workspaceId, paths) => {
          ctx.onFilesChanged?.(workspaceId, paths);
          ctx.onBuildWritten?.(build.objectId);
        },
      });
      try {
        const result = await runCommandTool.execute(
          { command: args.command },
          { caps: { capabilities: new Set<Capability>(['shell']), shell } },
        );
        return result.data;
      } catch (error) {
        return { ok: false, error: toolErrorMessage(error, 'The command could not be run.') };
      }
    },
  };
}
