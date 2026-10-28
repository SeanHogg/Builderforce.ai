/**
 * Activation wiring for the editor's local cost levers (WS-L) — one call from
 * `activate`, so the extension entry does not grow a line per lever:
 *
 *   - the install id partial cost-lever rollouts bucket by (`hostCostLevers.ts`);
 *   - where the bundle ships the tree-sitter grammars the symbol index parses with;
 *   - the local model `local_research` asks (`localResearch/editorResearchPort.ts`);
 *   - the knowledge index per root (`knowledge/index/`): the workspace fs it persists
 *     through and the saves that re-seed the workspace repository's cards.
 */

import * as path from "path";
import * as vscode from "vscode";
import { setHostInstallId } from "./hostCostLevers";
import { setSymbolGrammarDir } from "./workspaceSymbols";
import { setLocalResearchPort } from "./localResearch/researchPort";
import { editorResearchPort } from "./localResearch/editorResearchPort";
import { activateKnowledgeIndex } from "./knowledge/index/activateKnowledgeIndex";

export function activateLocalLevers(context: vscode.ExtensionContext): void {
  setHostInstallId(vscode.env.machineId);
  setSymbolGrammarDir(path.join(context.extensionPath, "out", "tree-sitter"));
  setLocalResearchPort(editorResearchPort());
  context.subscriptions.push(...activateKnowledgeIndex());
}
