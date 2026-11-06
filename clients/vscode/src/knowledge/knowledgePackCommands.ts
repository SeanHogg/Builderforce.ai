/**
 * The portable knowledge pack's editor entry points (PRD 40) — four commands, registered
 * from `registerKnowledgeCommands` so `extension.ts` stays untouched:
 *
 *   - `builderforce.createKnowledgePack` — review a workspace folder (skipped when its last
 *     review is current), then write the reviewed knowledge (snapshot + retrieval cards) as
 *     one `.bfpack` into the pack library (`<workspace>/.builderforce/knowledge/packs/<root stem>.bfpack`);
 *   - `builderforce.exportKnowledgePack` — write a reviewed root's pack (or an in-library
 *     one) to a path the person picks;
 *   - `builderforce.loadKnowledgePack` — open a `.bfpack` and make it queryable: its graph is
 *     indexed under its own root (`packs/packIndexing.ts`) and the pack remembered
 *     (`packs/loadedPackRegistry.ts`), so chat, Synapse and the knowledge view see it;
 *   - `builderforce.updateKnowledgePack` — re-review a loaded pack's source folder, merge
 *     fresh knowledge onto the pack (`mergePacksWithCards`, mirroring the folder), rewrite the file and re-index.
 *
 * A pack is LLM-agnostic: it carries the reviewed facts/relations plus the retrieval
 * cards (`toCards`), so any consumer — Synapse, Canvas, another editor — queries it and
 * injects top cards as context with nothing installed. The pure halves are in
 * `@builderforce/agent-tools/knowledge` (`packFromStore`, `packGraph`, `rebasePackRoot`).
 */

import * as path from "path";
import * as vscode from "vscode";
import { mergePacksWithCards, rebasePackRoot, type PortableKnowledgePack } from "@builderforce/agent-tools/knowledge";
import { rootFileStem, type KnowledgePackEntry } from "@builderforce/agent-tools/knowledge-index";
import { reviewedRoots, rootById, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { log, workspaceFolders } from "./knowledgeService";
import { loadedPackRegistry, recordOfPack } from "./packs/loadedPackRegistry";
import { indexPack, readPackFile, writePackFile } from "./packs/packIndexing";
import { provenanceDetail } from "./packs/packProvenanceDetail";
import { packOfRoot, reviewForPack } from "./packs/packReview";
import { registerPackPlatformCommands } from "./packs/packRemove";
import { PACK_FILTER, messageOf } from "./packs/packUi";

const countOf = (pack: PortableKnowledgePack) => ({
  sources: Object.values(pack.snapshot.extracted).reduce((n, list) => n + list.length, 0),
  facts: pack.snapshot.facts[pack.rootId]?.length ?? 0,
  relations: pack.snapshot.relations[pack.rootId]?.length ?? 0,
});

/**
 * A root's file in the pack library of the workspace folder holding it
 * (`<folder>/.builderforce/knowledge/packs/<root stem>.bfpack`). Named by the ROOT, not the
 * folder's name: `a/docs` and `b/docs` are two packs and never write the same file.
 */
const packLibraryFile = (folderPath: string, rootId: string): string =>
  path.join(folderPath, ".builderforce", "knowledge", "packs", `${rootFileStem(rootId)}.bfpack`);

/** A quick-pick's `detail` line for a loaded pack: who reviewed it and with which model, when recorded. */
const detailOf = (entry: KnowledgePackEntry): { detail?: string } => {
  const detail = provenanceDetail(loadedPackRegistry().recordOf(entry.rootId)?.provenance);
  return detail ? { detail } : {};
};

/** The folder the command was invoked on (explorer), else the one the person picks. */
async function folderToPack(uri: unknown): Promise<vscode.Uri | undefined> {
  if (uri instanceof vscode.Uri) return uri;
  const first = vscode.workspace.workspaceFolders?.[0]?.uri;
  return (await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t("Create Knowledge Pack"),
    ...(first ? { defaultUri: first } : {}),
  }))?.[0];
}

async function createKnowledgePack(context: vscode.ExtensionContext, uri?: unknown): Promise<void> {
  const target = await folderToPack(uri);
  if (!target) return;
  const root = rootForPath(target.fsPath, workspaceFolders());
  if (!root) {
    void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce packs folders inside the open workspace."));
    return;
  }
  const name = root.title || "knowledge";
  const { skipped, provenance } = await reviewForPack(
    context,
    root,
    vscode.l10n.t("BuilderForce: reviewing {0} for the knowledge pack…", root.title),
    { skipIfFresh: true },
  );
  const pack = await packOfRoot(context, root, name, provenance);
  const file = packLibraryFile(root.folderPath, root.rootId);
  await writePackFile(file, pack);
  await loadedPackRegistry().remember(name, recordOfPack(pack, file));
  const n = countOf(pack);
  void vscode.window.showInformationMessage(
    skipped
      ? vscode.l10n.t(
        "BuilderForce: nothing changed since the last review of {0} — knowledge pack \"{1}\" written to {2} ({3} sources, {4} facts, {5} relations).",
        root.title, name, file, n.sources, n.facts, n.relations,
      )
      : vscode.l10n.t(
        "BuilderForce: knowledge pack \"{0}\" written to {1} ({2} sources, {3} facts, {4} relations).",
        name, file, n.sources, n.facts, n.relations,
      ),
  );
}

/** The pack to export: an in-library one when picked, else the pack of a reviewed root. */
async function pickExportSource(
  context: vscode.ExtensionContext,
): Promise<{ pack: PortableKnowledgePack; defaultName: string } | undefined> {
  const packs = loadedPackRegistry().all();
  const roots = reviewedRoots(context.workspaceState)
    .map((id) => rootById(id, workspaceFolders()))
    .filter((r): r is KnowledgeRoot => !!r);
  interface PackPick extends vscode.QuickPickItem { entry?: KnowledgePackEntry; root?: KnowledgeRoot }
  const picks: PackPick[] = [
    ...packs.map((entry): PackPick => ({ label: entry.name, ...(entry.path ? { description: entry.path } : {}), ...detailOf(entry), entry })),
    ...roots.map((root): PackPick => ({ label: root.title, description: root.rootId, root })),
  ];
  if (picks.length === 0) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t("BuilderForce: no reviewed folder or loaded knowledge pack to export yet."),
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(picks, {
    placeHolder: vscode.l10n.t("Choose the knowledge pack (or reviewed folder) to export"),
  });
  if (!picked) return undefined;
  if (picked.entry) {
    try {
      return { pack: await readPackFile(picked.entry.path ?? ""), defaultName: picked.entry.name };
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not read the pack: {0}", messageOf(error)));
      return undefined;
    }
  }
  const root = picked.root!;
  const name = root.title || "knowledge";
  return { pack: await packOfRoot(context, root, name), defaultName: name };
}

async function exportKnowledgePack(context: vscode.ExtensionContext): Promise<void> {
  const source = await pickExportSource(context);
  if (!source) return;
  const target = await vscode.window.showSaveDialog({
    filters: PACK_FILTER,
    defaultUri: vscode.Uri.file(`${source.defaultName}.bfpack`),
    saveLabel: vscode.l10n.t("Export Knowledge Pack"),
  });
  if (!target) return;
  const out = target.fsPath.toLowerCase().endsWith(".bfpack") ? target.fsPath : `${target.fsPath}.bfpack`;
  await writePackFile(out, source.pack);
  void vscode.window.showInformationMessage(
    vscode.l10n.t("BuilderForce: knowledge pack \"{0}\" exported to {1}.", source.pack.name, out),
  );
}

async function loadKnowledgePack(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: PACK_FILTER,
    openLabel: vscode.l10n.t("Load Knowledge Pack"),
  });
  const file = picked?.[0]?.fsPath;
  if (!file) return;
  let pack: PortableKnowledgePack;
  try {
    pack = await readPackFile(file);
  } catch (error) {
    void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: {0}", messageOf(error)));
    return;
  }
  let nodes = 0;
  try {
    nodes = await indexPack(pack);
  } catch (error) {
    log(`pack index ${pack.rootId}`, error);
  }
  await loadedPackRegistry().remember(pack.name, recordOfPack(pack, file, new Date().toISOString()));
  const n = countOf(pack);
  void vscode.window.showInformationMessage(
    vscode.l10n.t("BuilderForce: knowledge pack \"{0}\" loaded ({1} facts, {2} relations, {3} cards indexed).", pack.name, n.facts, n.relations, nodes),
  );
}

/** Where a moved pack's source folder lives now; undefined when the person cancels. */
async function pickMovedFolder(title: string): Promise<vscode.Uri | undefined> {
  return (await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t("Use as the new location of {0}", title),
    title: vscode.l10n.t("The pack's source folder \"{0}\" is not in the open workspace — pick its new location", title),
  }))?.[0];
}

/** The pack to update: a remembered one the person picks, else a `.bfpack` file they choose. */
async function pickPackToUpdate(): Promise<{ name: string; file: string } | undefined> {
  const entries = loadedPackRegistry().all();
  if (entries.length > 0) {
    // Two packs may share a display name (two `docs` folders): the path tells them apart.
    const picked = await vscode.window.showQuickPick(
      entries.map((entry) => ({ label: entry.name, ...(entry.path ? { description: entry.path } : {}), ...detailOf(entry), entry })),
      { placeHolder: vscode.l10n.t("Choose the knowledge pack to update") },
    );
    return picked?.entry.path ? { name: picked.entry.name, file: picked.entry.path } : undefined;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: PACK_FILTER,
    openLabel: vscode.l10n.t("Update Knowledge Pack"),
  });
  const file = picked?.[0]?.fsPath;
  return file ? { name: path.basename(file).replace(/\.bfpack$/i, ""), file } : undefined;
}

async function updateKnowledgePack(context: vscode.ExtensionContext): Promise<void> {
  const choice = await pickPackToUpdate();
  if (!choice) return;
  let pack: PortableKnowledgePack;
  try {
    pack = await readPackFile(choice.file);
  } catch (error) {
    void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not read the pack: {0}", messageOf(error)));
    return;
  }
  const folders = workspaceFolders();
  let root = rootById(pack.rootId, folders);
  if (!root) {
    const moved = await pickMovedFolder(pack.title);
    if (!moved) return;
    root = rootForPath(moved.fsPath, folders);
    if (!root) {
      void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce packs folders inside the open workspace."));
      return;
    }
  }
  const before = countOf(pack);
  const { provenance } = await reviewForPack(context, root, vscode.l10n.t("BuilderForce: re-reviewing {0} for the knowledge pack…", root.title));
  // A moved folder reviews under ITS root id; the pack keeps its own, so the fresh knowledge is rebased onto it.
  const fresh = rebasePackRoot(await packOfRoot(context, root, pack.name, provenance), pack.rootId);
  // Update mirrors the folder: files it no longer holds leave the pack, and the cards are rebuilt from what the pack now holds.
  const merged = await mergePacksWithCards(pack, fresh, { mirror: true });
  await writePackFile(choice.file, merged);
  try {
    await indexPack(merged);
  } catch (error) {
    log(`pack index ${merged.rootId}`, error);
  }
  await loadedPackRegistry().remember(choice.name, recordOfPack(merged, choice.file, new Date().toISOString()));
  const after = countOf(merged);
  void vscode.window.showInformationMessage(
    vscode.l10n.t(
      "BuilderForce: knowledge pack \"{0}\" updated — facts {1} → {2}, relations {3} → {4}.",
      choice.name, before.facts, after.facts, before.relations, after.relations,
    ),
  );
}

/** The four portable-pack commands (PRD 40), in `registerKnowledgeCommands`' style. */
export function registerKnowledgePackCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("builderforce.createKnowledgePack", (uri?: unknown) => createKnowledgePack(context, uri)),
    vscode.commands.registerCommand("builderforce.exportKnowledgePack", () => exportKnowledgePack(context)),
    vscode.commands.registerCommand("builderforce.loadKnowledgePack", () => loadKnowledgePack()),
    vscode.commands.registerCommand("builderforce.updateKnowledgePack", () => updateKnowledgePack(context)),
    ...registerPackPlatformCommands(context),
  );
}
