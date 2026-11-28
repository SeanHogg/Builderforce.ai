import { commandWords, gitSubcommand, shellTokens, splitShellSegments } from './shell-segments.js';
import { shellFailure } from './shell-job-types.js';

const SYSTEM_MAINTENANCE = /^(?:mkfs(?:\.[\w-]+)?|mkswap|diskpart(?:\.exe)?|format\.com|format-volume|clear-disk|shutdown(?:\.exe)?|reboot|poweroff)$/i;

function workspaceInvocations(command: string) {
  return (splitShellSegments(command) ?? []).map((segment) => {
    const [program, ...args] = commandWords(shellTokens(segment));
    return { name: program?.split(/[\\/]/).at(-1)?.toLowerCase(), args };
  });
}

/** Workspace shells reserve system and disk maintenance for administrative tools. */
export function workspaceCommandRefusal(command: string): ReturnType<typeof shellFailure> | undefined {
  if (command.includes('\0')) return shellFailure('invalid', 'The shell command contains a null character.');
  for (const { name } of workspaceInvocations(command)) {
    if (name && SYSTEM_MAINTENANCE.test(name)) {
      return shellFailure('refused', 'System maintenance commands are outside the workspace shell policy.');
    }
  }
  return undefined;
}

/** A workspace checkout can lose tracked edits or untracked files in these operations. */
export function workspaceCommandNeedsConfirmation(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return workspaceInvocations(command).some(({ name, args }) => {
    if (name !== 'git' && name !== 'git.exe') return false;
    const { sub, rest } = gitSubcommand(args);
    const flags = rest.slice(0, rest.includes('--') ? rest.indexOf('--') : rest.length);
    if (sub === 'reset') return flags.includes('--hard');
    return sub === 'clean' && flags.some((flag) => flag === '--force' || /^-[a-z]*f[a-z]*$/i.test(flag));
  });
}

export type ExecSecurity = 'deny' | 'allowlist' | 'full';
export type ExecAsk = 'off' | 'on-miss' | 'always';

export function requiresExecApproval(params: {
  ask: ExecAsk;
  security: ExecSecurity;
  analysisOk: boolean;
  allowlistSatisfied: boolean;
}): boolean {
  return params.ask === 'always' ||
    (params.ask === 'on-miss' && params.security === 'allowlist' && (!params.analysisOk || !params.allowlistSatisfied));
}
