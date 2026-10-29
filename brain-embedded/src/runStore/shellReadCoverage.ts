/**
 * A read-only `run_command` that printed one workspace file (`cat F`, `sed -n 'A,Bp' F`,
 * `head`/`tail`, after an optional `cd X &&`) is recorded as the `read_file` it stands for
 * (PRD 35 E1) — so the visit tally sees the revisit and a later `read_file` of the same
 * lines is a covered window, not a second read.
 *
 * The rule — which calls qualify (a read-only shell command, a clean exit, output the model
 * was handed WHOLE) and how a print becomes a read — lives ONCE, in `@builderforce/run-guards`
 * (`shellPrint.ts`), shared with the agent's read coverage. This module is the Brain's import
 * path for it and holds none.
 */

export { recordShellFileRead } from '@builderforce/run-guards';
