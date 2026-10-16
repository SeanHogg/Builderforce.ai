/**
 * Paths in a workspace that are installed dependencies or build output rather than the
 * app's source: never worth a model's attention, and never saved back to the store from
 * a run (`npm install` and `npm run build` write thousands of them).
 *
 * One rule, shared by the Brain's build tools (`lib/canvasBuildTools.ts`) and the
 * in-browser shell (`lib/browserRuntime/workspaceShell.ts`), so what a model can list
 * and what a command may persist cannot disagree.
 */
const GENERATED_DIRECTORIES = ['node_modules/', 'dist/', '.git/'];

/** True for a workspace-relative path inside dependencies or build output. */
export function isGeneratedPath(path: string): boolean {
  return GENERATED_DIRECTORIES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix) || path.includes(`/${prefix}`));
}
