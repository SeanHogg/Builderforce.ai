/**
 * Where the build puts the tree-sitter wasm, under the package's `dist/` — written by
 * `scripts/copy-tree-sitter-wasm.ts`, read by `on-prem-symbol-index.ts`. Its own module so
 * the build script imports one constant, not the runtime's dependency graph.
 */
export const TREE_SITTER_DIST_DIR = "tree-sitter";
