/**
 * In-run build / type-check / test (ticket 3092).
 *
 * The durable Worker has no shell — it must NOT pretend `npm test` ran. Container
 * and GitHub Actions images (and on-prem) have a real process and already exec via
 * `run_command`; these helpers tell them WHICH package scripts to run after code
 * changes and BEFORE `finish`, and they record an honest skip when there is no
 * shell. They do not invent SSH, and they do not invent a script the package.json
 * does not declare.
 *
 * Pure: the image reads `package.json` in its clone and passes `packageScripts`
 * in. The Worker never execs these commands (it cannot).
 */

export type InRunVerifySurface = 'durable' | 'container' | 'github_actions' | 'on-prem';

/** Script names we will run, in order, when present on the nearest package.json. */
export const IN_RUN_VERIFY_SCRIPT_NAMES = ['typecheck', 'type-check', 'test'] as const;

export const DURABLE_IN_RUN_VERIFY_NOTE =
  'Durable/Worker has no shell. Typecheck/test are skipped in-run; CI on the pull request is the source of truth. Never claim those checks passed.';

export const CONTAINER_IN_RUN_VERIFY_NOTE =
  'After code changes, run these via the image shell (`run_command`) before finish. Do not invent SSH.';

export type PackageScriptRunner = 'npm' | 'pnpm' | 'yarn';

export type InRunVerifyCommandResult = { command: string; exitCode: number };

export type InRunVerifyPlan =
  | {
      kind: 'skipped';
      surface: 'durable';
      reason: 'no_shell';
      commands: [];
      scriptNames: typeof IN_RUN_VERIFY_SCRIPT_NAMES;
      note: string;
    }
  | {
      kind: 'run';
      surface: 'container' | 'github_actions' | 'on-prem';
      reason: null;
      commands: string[];
      scriptNames: typeof IN_RUN_VERIFY_SCRIPT_NAMES;
      note: string;
    };

export type InRunVerifyOutcome = {
  surface: InRunVerifySurface;
  kind: 'skipped' | 'pending' | 'ran';
  reason: 'no_shell' | 'nothing_written' | 'no_scripts' | 'verify_failed' | 'verify_passed' | 'not_yet_run' | null;
  commands: string[];
  failedCommands: string[];
  /** Finish may proceed. Durable skip is allowed; a container that wrote code and has not verified is not. */
  mayFinish: boolean;
  note: string;
};

function firstDeclaredScript(
  scripts: Record<string, string> | null | undefined,
  names: readonly string[],
): string | null {
  if (!scripts) return null;
  for (const name of names) {
    const body = scripts[name];
    if (typeof body === 'string' && body.trim()) return name;
  }
  return null;
}

/**
 * Commands the image should exec via existing `run_command` / shell capability.
 * Prefers `typecheck` over `type-check`; never emits `npm test` when no `test`
 * script exists.
 */
export function packageVerifyCommands(
  scripts: Record<string, string> | null | undefined,
  runner: PackageScriptRunner = 'npm',
): string[] {
  const cmds: string[] = [];
  const typecheck = firstDeclaredScript(scripts, ['typecheck', 'type-check']);
  if (typecheck) cmds.push(`${runner} run ${typecheck}`);
  const test = firstDeclaredScript(scripts, ['test']);
  if (test) cmds.push(`${runner} run ${test}`);
  return cmds;
}

export function planInRunVerify(input: {
  surface: InRunVerifySurface;
  packageScripts?: Record<string, string> | null;
  runner?: PackageScriptRunner;
}): InRunVerifyPlan {
  if (input.surface === 'durable') {
    return {
      kind: 'skipped',
      surface: 'durable',
      reason: 'no_shell',
      commands: [],
      scriptNames: IN_RUN_VERIFY_SCRIPT_NAMES,
      note: DURABLE_IN_RUN_VERIFY_NOTE,
    };
  }
  const commands = packageVerifyCommands(input.packageScripts, input.runner);
  return {
    kind: 'run',
    surface: input.surface,
    reason: null,
    commands,
    scriptNames: IN_RUN_VERIFY_SCRIPT_NAMES,
    note: commands.length > 0
      ? CONTAINER_IN_RUN_VERIFY_NOTE
      : 'No typecheck/test scripts in package.json; skip package verify (CI on the PR still applies).',
  };
}

function wroteCode(writtenPaths: ReadonlySet<string> | readonly string[] | undefined): boolean {
  if (!writtenPaths) return false;
  return 'size' in writtenPaths ? writtenPaths.size > 0 : writtenPaths.length > 0;
}

/**
 * Honest v1 gate: durable records a skip (and may finish); container/on-prem that
 * wrote code must have run the planned commands (all exit 0) before finish.
 * A failed command blocks finish. Missing results after a write is `pending`,
 * not a silent pass.
 */
export function inRunVerifyOutcome(input: {
  surface: InRunVerifySurface;
  writtenPaths?: ReadonlySet<string> | readonly string[];
  packageScripts?: Record<string, string> | null;
  runner?: PackageScriptRunner;
  results?: ReadonlyArray<InRunVerifyCommandResult> | null;
}): InRunVerifyOutcome {
  const plan = planInRunVerify(input);
  if (plan.kind === 'skipped') {
    return {
      surface: 'durable',
      kind: 'skipped',
      reason: 'no_shell',
      commands: [],
      failedCommands: [],
      mayFinish: true,
      note: plan.note,
    };
  }
  if (!wroteCode(input.writtenPaths)) {
    return {
      surface: plan.surface,
      kind: 'skipped',
      reason: 'nothing_written',
      commands: plan.commands,
      failedCommands: [],
      mayFinish: true,
      note: 'No code written this run; in-run typecheck/test is not required.',
    };
  }
  if (plan.commands.length === 0) {
    return {
      surface: plan.surface,
      kind: 'skipped',
      reason: 'no_scripts',
      commands: [],
      failedCommands: [],
      mayFinish: true,
      note: plan.note,
    };
  }
  if (input.results == null) {
    return {
      surface: plan.surface,
      kind: 'pending',
      reason: 'not_yet_run',
      commands: plan.commands,
      failedCommands: [],
      mayFinish: false,
      note: `${CONTAINER_IN_RUN_VERIFY_NOTE} Planned: ${plan.commands.join(' && ')}.`,
    };
  }
  const byCommand = new Map(input.results.map((r) => [r.command, r.exitCode]));
  const failedCommands = plan.commands.filter((c) => (byCommand.get(c) ?? 1) !== 0);
  if (failedCommands.length > 0) {
    return {
      surface: plan.surface,
      kind: 'ran',
      reason: 'verify_failed',
      commands: plan.commands,
      failedCommands,
      mayFinish: false,
      note: `In-run verify failed: ${failedCommands.join(', ')}. Fix before finish.`,
    };
  }
  return {
    surface: plan.surface,
    kind: 'ran',
    reason: 'verify_passed',
    commands: plan.commands,
    failedCommands: [],
    mayFinish: true,
    note: `In-run verify passed: ${plan.commands.join(' && ')}.`,
  };
}
