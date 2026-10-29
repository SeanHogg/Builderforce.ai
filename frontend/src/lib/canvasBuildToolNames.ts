/**
 * Which build tools COMMIT to a workspace, which write a file, and the whole set. Split out of
 * `canvasBuildTools.ts`; the turn runner reads these to count build work.
 */

/**
 * The build tools that COMMIT to a workspace the moment they return — no proposal,
 * no review step. They answer `applied: true` (the committed twin of the staging
 * tools' `proposed: true`) so the turn runner counts them as canvas work.
 *
 * Measured why that matters (session `bf886fc1`, ui 2026.9.13, "create app"): a turn
 * provisioned a workspace and wrote five files, and because none of that was a
 * *proposal* the runner concluded nothing had happened — the user read "I couldn't
 * prepare any canvas changes from that request" above a working app, the act-now
 * ladder nagged a model that had already acted, and the step budget sized for
 * authoring one card ran out mid-file.
 */
export const CANVAS_BUILD_WORKSPACE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'canvas_create_build',
  'canvas_write_build_file',
  'canvas_edit_build_file',
  'canvas_restore_build_file',
]);

/**
 * The subset of {@link CANVAS_BUILD_WORKSPACE_WRITE_TOOLS} that writes the APP — every one
 * but `canvas_create_build`, which only seeds the starter template.
 *
 * Measured why the distinction matters (session `local-148925cf`, ui 2026.10.27, "Build a
 * social media website that offers phone plans"): the turn called `canvas_create_build`,
 * read the provisioning as the deliverable, and stopped — the user got "I've created a new
 * web project… you can now start adding files" above a preview reading "Hello World!".
 * Counting provisioning as canvas work is right (it IS a board change); counting it as the
 * app being built is not, and the runner needs to tell the two apart.
 */
export const CANVAS_BUILD_FILE_WRITE_TOOLS: ReadonlySet<string> = new Set(
  [...CANVAS_BUILD_WORKSPACE_WRITE_TOOLS].filter((name) => name !== 'canvas_create_build'),
);

/** Every tool name this module contributes. Used by the guest-boundary contract. */
export const CANVAS_BUILD_TOOL_NAMES = [
  'canvas_create_build',
  'canvas_list_build_files',
  'canvas_read_build_file',
  'canvas_search_build_files',
  'canvas_write_build_file',
  'canvas_edit_build_file',
  'canvas_read_build_diagnostics',
  'canvas_read_preview_console',
  'canvas_list_build_file_history',
  'canvas_restore_build_file',
  'canvas_run_build_command',
] as const;

/**
 * Every build tool as a set: a turn that calls ANY of them is working inside an app, so it
 * gets the code step budget from that call on — not only from its first write.
 *
 * Measured why (session `local-148925cf`, ui 2026.10.35): "continue" after a build turn ran
 * out of steps spent all eight research-sized steps re-reading the app's files, never
 * reached an edit, and answered "I couldn't prepare any canvas changes". Reading the files
 * is the first half of editing them.
 */
export const CANVAS_BUILD_TOOLS: ReadonlySet<string> = new Set(CANVAS_BUILD_TOOL_NAMES);
