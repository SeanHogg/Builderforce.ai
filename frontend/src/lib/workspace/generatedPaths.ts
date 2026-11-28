/**
 * Paths in a workspace that are installed dependencies or build output rather than the
 * app's source: never worth a model's attention, and never saved back to the store from
 * a run (`npm install` and `npm run build` write thousands of them).
 *
 * One rule, shared by the Brain's build tools (`lib/canvasBuildTools.ts`), the
 * in-browser shell (`lib/browserRuntime/workspaceShell.ts`) and the run loop's file
 * mount (`lib/runTarget/projectRunFiles.ts`), so what a model can list, what a command
 * may persist and what a run mounts cannot disagree. Framework caches (Next, SvelteKit,
 * wrangler, Turborepo) are build output too.
 */
// Not the walk ignore list (`OUTPUT_DIRS`, agent-tools skipDirs.ts): this decides what a run SAVES BACK, so it is
// deliberately narrower (a user's `build/`, `out/` or `coverage/` may be source and must persist; a walk skips them).
const GENERATED_DIRECTORIES = ['node_modules/', 'dist/', '.git/', '.next/', '.svelte-kit/', '.wrangler/', '.turbo/'];

/** True for a workspace-relative path inside dependencies or build output. */
export function isGeneratedPath(path: string): boolean {
  return GENERATED_DIRECTORIES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix) || path.includes(`/${prefix}`));
}
