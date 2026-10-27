#!/usr/bin/env tsx
/**
 * Copy the symbol index's tree-sitter wasm into dist/tree-sitter/ — the web-tree-sitter
 * runtime plus every grammar the extractor uses (`node-tree-sitter.ts`).
 *
 * The bundle inlines agent-tools' JS, but a `.wasm` is not JS: without this copy a
 * published install has no grammar to load and every file falls back to the regex
 * extractor. The runtime looks here first (`src/agents/on-prem-symbol-index.ts`). The
 * grammar list is IMPORTED from the extractor, so a grammar added there ships without a
 * second list to keep in step. Resolved from agent-tools, which declares both packages.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TREE_SITTER_GRAMMAR_WASMS,
  TREE_SITTER_RUNTIME_WASM,
} from "../../packages/agent-tools/src/node-tree-sitter.js";
import { TREE_SITTER_DIST_DIR } from "../src/agents/tree-sitter-dist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const agentTools = path.resolve(projectRoot, "..", "packages", "agent-tools");

function copyTreeSitterWasm() {
  const req = createRequire(path.join(agentTools, "package.json"));
  let runtimeWasm: string;
  let grammarDir: string;
  try {
    runtimeWasm = path.join(path.dirname(req.resolve("web-tree-sitter")), TREE_SITTER_RUNTIME_WASM);
    grammarDir = path.join(path.dirname(req.resolve("tree-sitter-wasms/package.json")), "out");
  } catch (err) {
    console.warn(`[copy-tree-sitter-wasm] tree-sitter packages not installed (${String(err)}): symbols use the regex extractor.`);
    return;
  }
  const target = path.join(projectRoot, "dist", TREE_SITTER_DIST_DIR);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(runtimeWasm, path.join(target, TREE_SITTER_RUNTIME_WASM));
  for (const file of TREE_SITTER_GRAMMAR_WASMS) {
    const from = path.join(grammarDir, file);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(target, file));
    } else {
      console.warn(`[copy-tree-sitter-wasm] no grammar ${file}: that language's symbols use the regex extractor.`);
    }
  }
  console.log(`[copy-tree-sitter-wasm] Copied ${TREE_SITTER_GRAMMAR_WASMS.length + 1} wasm file(s) to dist/${TREE_SITTER_DIST_DIR}`);
}

copyTreeSitterWasm();
