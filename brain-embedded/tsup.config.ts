import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';
import { libraryConfig, REACT_EXTERNALS } from '../scripts/tsup.base.mjs';
import { sourcePackageAliasMap } from '../scripts/sourcePackages.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
/**
 * The source-only packages, derived from their manifests. esbuild resolves a bare
 * import from the REAL path of the importing file, so a linked package that itself
 * imports another (`@builderforce/run-policy` → `@builderforce/agent-stall`) is looked
 * up under `packages/run-policy`, which has no install. Aliasing the whole set
 * resolves every edge from anywhere — the JS bundle and the declaration program alike.
 */
const sourceAliases = sourcePackageAliasMap(path.resolve(root, '..'));

export default defineConfig(libraryConfig({
  // `chatError` is a SECOND entry, not just a re-export off the root: it is pure
  // TypeScript with no React, so a non-React host (the VS Code extension process,
  // which renders chat errors in its own native surfaces) can share the ONE
  // error classifier without bundling React and the whole hook layer with it.
  entry: { index: 'src/index.ts', chatError: 'src/chatError.ts' },
  // `resolve`, not a bare `true`. The JS bundles already inline
  // `@builderforce/agent-stall` (it is a devDependency, so tsup does not treat it
  // as external) — but `dts: true` left the DECLARATIONS re-exporting the bare
  // specifier, and that package ships no `dist`, is not a runtime dependency, and
  // is wired by `link:`, so nothing a consumer installs can resolve it. Six
  // exports arrived typeless in the published package and `skipLibCheck` kept it
  // quiet. Anything under `@builderforce/` is source-only by construction, so the
  // pattern covers the next one too.
  //
  // `rootDir` is widened for the declaration program only: resolving the packages
  // pulls their `src` into it, and the package's own `rootDir: "src"` rejects that
  // with TS6059. The declaration build emits nothing through this program — tsup
  // rolls the types up itself — so the wider root costs nothing and the app's own
  // `tsc --noEmit` keeps the narrow one. It is the repo root because the `paths`
  // below point at `packages/*/src`, outside this package.
  dts: {
    resolve: [/^@builderforce\//],
    compilerOptions: {
      rootDir: '..',
      paths: Object.fromEntries(Object.entries(sourceAliases).map(([specifier, entry]) => [specifier, [entry]])),
    },
  },
  external: REACT_EXTERNALS,
  extra: {
    esbuildOptions(options: { alias?: Record<string, string> }) {
      options.alias = { ...(options.alias ?? {}), ...sourceAliases };
    },
  },
}));
