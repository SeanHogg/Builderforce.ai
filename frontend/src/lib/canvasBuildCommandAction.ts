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
import { commandStatusTool, commandStopTool, runCommandTool, workspaceCommandNeedsConfirmation, type Capability, type ShellCapability } from '@builderforce/agent-tools';
import { createWorkspaceShell } from '@/lib/browserRuntime/workspaceShell';
import { recordBuildFailure } from '@/lib/buildDiagnostics';
import type { BoundCanvasBuild, CanvasBuildToolsContext } from '@/lib/canvasBuildTools';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';
import { CANVAS_SHELL_TOOLS } from '@builderforce/creation-canvas-contract';

const SHARED = runCommandTool.schema.function;

/**
 * The shared tool rejects a blank command before the shell starts. That is a bad
 * tool call, not a workspace failure — recording it would make
 * `canvas_read_build_diagnostics` blame a build that never ran.
 */
const COMMAND_NOT_RUN = 'command is required';

/**
 * A command the agent ran that failed. The manual Run button already writes here
 * (`useWorkspaceRun`); this is the only other way a build command runs, and until
 * it wrote the same ledger the agent was told "no errors recorded" for a command
 * it had just watched fail.
 */
function recordFailedCommand(workspaceId: WorkspaceId, command: unknown, data: Record<string, unknown>): void {
  if (data.ok !== false) return;
  const error = typeof data.error === 'string' ? data.error : '';
  if (error === COMMAND_NOT_RUN) return;
  const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined;
  const stdout = typeof data.stdout === 'string' ? data.stdout : '';
  const commandText = typeof command === 'string' ? command.trim() : '';
  recordBuildFailure(workspaceId, {
    source: 'build',
    ...(commandText ? { command: commandText } : {}),
    ...(exitCode != null ? { exitCode } : {}),
    message: error || (exitCode != null ? `Command failed (exit ${exitCode}).` : 'The command failed.'),
    ...(stdout.trim() ? { detail: stdout } : {}),
  });
}

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
export function canvasBuildCommandActions(
  ctx: Pick<CanvasBuildToolsContext, 'onFilesChanged' | 'onBuildWritten' | 'confirmShellCommand'>,
  resolve: (objectId: unknown) => { build: BoundCanvasBuild } | { error: string },
): BrainAction[] {
  const shells = new Map<string, ShellCapability>();
  const capabilities = new Set<Capability>(['shell', 'shell.jobs']);
  const forSurface = (description: string) => description
    .replace(/\brun_command\b/g, CANVAS_SHELL_TOOLS.run)
    .replace(/\bcommand_status\b/g, CANVAS_SHELL_TOOLS.status)
    .replace(/\bcommand_stop\b/g, CANVAS_SHELL_TOOLS.stop);
  const definitions = [
    {
      name: CANVAS_SHELL_TOOLS.run, tool: runCommandTool, mutates: true,
      description: `${SHARED_DESCRIPTION} Run npm, node, npx and shell commands against this build's files. Pipeline failures keep their nonzero status. File changes are saved to the workspace. Use background mode for a long build or test, then check it with ${CANVAS_SHELL_TOOLS.status}. The live preview already runs the app. Check failed builds and preview errors with canvas_read_build_diagnostics.`,
    },
    { name: CANVAS_SHELL_TOOLS.status, tool: commandStatusTool, mutates: false },
    { name: CANVAS_SHELL_TOOLS.stop, tool: commandStopTool, mutates: true },
  ];
  return definitions.map(({ name, tool, mutates, description }) => ({
    name,
    mutates,
    description: forSurface(description ?? tool.schema.function.description),
    parameters: {
      ...tool.schema.function.parameters,
      additionalProperties: false,
      properties: {
        ...tool.schema.function.parameters.properties,
        objectId: { type: 'string', description: 'Builder object id. Omit when the board has one.' },
      },
    },
    run: async (raw: unknown) => {
      const args = raw as Record<string, unknown>;
      const resolved = resolve(args.objectId);
      if ('error' in resolved) return resolved;
      const { build } = resolved;
      const scope = JSON.stringify([build.objectId, build.store.kind, build.store.id]);
      let shell = shells.get(scope);
      if (!shell) {
        const workspace = createWorkspaceShell(build.store, {
          onFilesChanged: (workspaceId, paths) => {
            ctx.onFilesChanged?.(workspaceId, paths);
            ctx.onBuildWritten?.(build.objectId);
          },
          onBackgroundComplete: (command, result) => recordFailedCommand(build.store.id, command, { ...result }),
        });
        shell = {
          ...workspace,
          async authorize(command) {
            const allowed = !workspaceCommandNeedsConfirmation(command) ||
              (await ctx.confirmShellCommand?.(command)) === true;
            return { allowed };
          },
        };
        shells.set(scope, shell);
      }
      try {
        const result = await tool.execute(args, { caps: { capabilities, shell } });
        const { data } = result;
        if (tool === runCommandTool && args.yieldMs === undefined) recordFailedCommand(build.store.id, args.command, data);
        return typeof data.note === 'string' ? { ...data, note: forSurface(data.note) } : data;
      } catch (error) {
        const message = toolErrorMessage(error, 'The command could not be run.');
        if (tool === runCommandTool) recordFailedCommand(build.store.id, args.command, { ok: false, error: message });
        return { ok: false, error: message };
      }
    },
  }));
}
