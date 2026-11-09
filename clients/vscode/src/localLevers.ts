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
import { setOutlineFirstReads } from "./outlineFirstReads";
import { setSymbolGrammarDir } from "./workspaceSymbols";
import { setLocalResearchPort } from "./localResearch/researchPort";
import { editorResearchPort } from "./localResearch/editorResearchPort";
import { activateKnowledgeIndex } from "./knowledge/index/activateKnowledgeIndex";
import { activateLoadedPacks } from "./knowledge/packs/activateLoadedPacks";

/**
 * Read the `builderforce.agent.outlineFirstReads` setting now and whenever it changes
 * (B2, PRD 45 §4.7) — the default (`true`) keeps outline-first reads on, `false` turns
 * them off for this install.
 */
function syncOutlineFirstReads(): void {
  setOutlineFirstReads(vscode.workspace.getConfiguration("builderforce.agent").get<boolean>("outlineFirstReads"));
}

export function activateLocalLevers(context: vscode.ExtensionContext): void {
  setHostInstallId(vscode.env.machineId);
  syncOutlineFirstReads();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("builderforce.agent.outlineFirstReads")) syncOutlineFirstReads();
    }),
  );
  setSymbolGrammarDir(path.join(context.extensionPath, "out", "tree-sitter"));
  setLocalResearchPort(editorResearchPort());
  context.subscriptions.push(...activateKnowledgeIndex());
  activateLoadedPacks(context.globalState);
}
