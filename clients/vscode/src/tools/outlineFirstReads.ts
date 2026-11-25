/**
 * The B2 outline-first-reads setting for the editor host (PRD 45 §4.7 B2).
 *
 * The `read_file` cost lever `c10_outline_first_reads` is on at rollout 100, so by
 * default a first whole-file read of a large file answers with the file's OUTLINE plus
 * its first 40 lines. The `builderforce.agent.outlineFirstReads` setting (default
 * `true`) lets a user turn that off on this install; the answer is handed to the shared
 * `read_file` tool through `ToolContext.outlineFirstReads`.
 *
 * Pure (no `vscode` import) so the tool dispatch and its tests can read it without an
 * editor — the same pattern as {@link setHostInstallId} in `hostCostLevers.ts`. The
 * activation path (`localLevers.ts`) calls {@link syncOutlineFirstReadsSetting} once and
 * subscribes to configuration changes; where neither has run (a unit test, the headless
 * harness) the default is `true` (the lever is on at 100).
 */

let outlineFirstReads: boolean | null = null;

/**
 * The VS Code `builderforce.agent.outlineFirstReads` setting's current value, handed in
 * at activation and on every configuration change. `null` restores the default (`true`).
 */
export function setOutlineFirstReads(on: boolean | null | undefined): void {
  outlineFirstReads = typeof on === "boolean" ? on : null;
}

/** Whether this install's first whole-file reads of large files answer in outline. */
export function outlineFirstReadsOn(): boolean {
  return outlineFirstReads ?? true;
}
