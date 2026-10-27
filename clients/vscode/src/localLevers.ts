/**
 * Activation wiring for the editor's local cost levers (WS-L) — one call from
 * `activate`, so the extension entry does not grow a line per lever:
 *
 *   - the install id partial cost-lever rollouts bucket by (`hostCostLevers.ts`);
 *   - where the bundle ships the tree-sitter grammars the symbol index parses with;
 *   - the local model `local_research` asks (`localResearch/editorResearchPort.ts`).
 */

import * as path from "path";
import * as vscode from "vscode";
import { setHostInstallId } from "./hostCostLevers";
import { setSymbolGrammarDir } from "./workspaceSymbols";
import { setLocalResearchPort } from "./localResearch/researchPort";
import { editorResearchPort } from "./localResearch/editorResearchPort";

export function activateLocalLevers(context: vscode.ExtensionContext): void {
  setHostInstallId(vscode.env.machineId);
  setSymbolGrammarDir(path.join(context.extensionPath, "out", "tree-sitter"));
  setLocalResearchPort(editorResearchPort());
}
