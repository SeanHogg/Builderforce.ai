/**
 * The built-output import scan behind `check-publishable-deps.mjs`, pinned. Run with plain `node --test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bareImports, packageNameOf, undeclaredImports } from './distImports.mjs';

const pkg = { dependencies: { 'mp4-muxer': '^5' }, peerDependencies: { 'onnxruntime-web': '>=1', '@scope/peer': '*' } };

test('package names collapse subpaths, scoped and unscoped', () => {
  assert.equal(packageNameOf('onnxruntime-web/webgpu'), 'onnxruntime-web');
  assert.equal(packageNameOf('@webdit/runtime/nn'), '@webdit/runtime');
});

test('every import form is seen; relative paths and builtins are not', () => {
  const src = [
    'import a from "mp4-muxer";',
    "import 'side-effect';",
    'export * from "@webdit/runtime";',
    'const m = await import("onnxruntime-web/webgpu");',
    'const r = require("left-pad");',
    'import fs from "node:fs";',
    'import p from "path";',
    'import x from "./chunk-ABC.mjs";',
  ].join('\n');
  assert.deepEqual([...bareImports(src)].sort(), ['@webdit/runtime', 'left-pad', 'mp4-muxer', 'onnxruntime-web', 'side-effect']);
});

test('declared dependencies and peers pass; a leaked private package fails', () => {
  const src = 'import "mp4-muxer"; import("onnxruntime-web/webgpu"); import("@webdit/runtime");';
  assert.deepEqual(undeclaredImports(src, pkg), ['@webdit/runtime']);
});

test('an explicit allowlist admits a named package', () => {
  assert.deepEqual(undeclaredImports('import "left-pad";', pkg, ['left-pad']), []);
});

test('a quoted import in a doc comment, or code after a bare from/import token, is not a package import', () => {
  const doc = '/**\n *   import { x } from \'@self/pkg/server\';\n */\nexport declare const y: number;';
  assert.deepEqual([...bareImports(doc)], []);
  const minified = 'var a={from:"x"};function f(){return import"a"+g(e,{checkoutEveryNms:r,blockClass:s=".x"})}';
  assert.deepEqual([...bareImports(minified)].sort(), ['a']);
});
