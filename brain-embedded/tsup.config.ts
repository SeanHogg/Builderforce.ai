import { defineConfig } from 'tsup';

export default defineConfig({
  // `chatError` is a SECOND entry, not just a re-export off the root: it is pure
  // TypeScript with no React, so a non-React host (the VS Code extension process,
  // which renders chat errors in its own native surfaces) can share the ONE
  // error classifier without bundling React and the whole hook layer with it.
  entry: { index: 'src/index.ts', chatError: 'src/chatError.ts' },
  format: ['esm', 'cjs'],
  // `resolve`, not a bare `true`. The JS bundles already inline
  // `@builderforce/agent-stall` (it is a devDependency, so tsup does not treat it
  // as external) — but `dts: true` left the DECLARATIONS re-exporting the bare
  // specifier, and that package ships no `dist`, is not a runtime dependency, and
  // is wired by `link:`, so nothing a consumer installs can resolve it. Six
  // exports arrived typeless in the published package and `skipLibCheck` kept it
  // quiet. Anything under `@builderforce/` is source-only by construction, so the
  // pattern covers the next one too.
  //
  // `rootDir` is widened for the declaration program only: resolving the package
  // pulls `node_modules/@builderforce/agent-stall/src/index.ts` into it, and the
  // package's own `rootDir: "src"` rejects that with TS6059. The declaration
  // build emits nothing through this program — tsup rolls the types up itself —
  // so the wider root costs nothing and the app's own `tsc --noEmit` keeps the
  // narrow one.
  dts: { resolve: [/^@builderforce\//], compilerOptions: { rootDir: '.' } },
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
