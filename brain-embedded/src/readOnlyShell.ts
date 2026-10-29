/**
 * Does this shell command only LOOK at the workspace?
 *
 * The classifier — every segment of a command a known read-only program, no redirection into
 * a file, conservative by construction — lives ONCE, in `@builderforce/run-guards`, where the
 * Brain's read guard and the agent's (`@builderforce/agent-run` `policy/tools`) both read it,
 * so both keep their cached answers across the same commands. This module is the Brain's
 * import path for it and holds none.
 */

export { isReadOnlyShellCall, isReadOnlyShellCommand } from '@builderforce/run-guards';
