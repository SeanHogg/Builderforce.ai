/**
 * The portable knowledge pack's editor entry points (PRD 40) — four commands, registered
 * from `registerKnowledgeCommands` so `extension.ts` stays untouched:
 *
 *   - `builderforce.createKnowledgePack` — review a workspace folder, then write the
 *     reviewed knowledge (snapshot + retrieval cards) as one `.bfpack` into the pack
 *     library (`<workspace>/.builderforce/knowledge/packs/<name>.bfpack`);
 *   - `builderforce.exportKnowledgePack` — write a reviewed root's pack (or an in-library
 *     one) to a path the person picks;
 *   - `builderforce.loadKnowledgePack` — open a `.bfpack` and make it queryable: its
 *     snapshot is loaded into an in-memory snapshot store, its graph built and upserted
 *     into the host knowledge index, and the pack remembered (globalState);
 *   - `builderforce.updateKnowledgePack` — re-review a loaded pack's source folder, merge
 *     fresh knowledge onto the pack (`mergePacks`), rewrite the file and re-upsert.
 *
 * A pack is LLM-agnostic: it carries the reviewed facts/relations plus the retrieval
 * cards (`toCards`), so any consumer — Synapse, Canvas, another editor — queries it and
 * injects top cards as context with nothing installed.
 */

import * as path from "path";
import * as vscode from "vscode";
import {
  buildStoredGraph,
  fileManifest,
  mergePacks,
  packFromSnapshot,
  parsePack,
  reviewPacks,
  serializePack,
  snapshotFileName,
  type PortableKnowledgePack,
} from "@builderforce/agent-tools/knowledge";
import {
  localSnapshotStore,
  toCards,
  type IndexDoc,
  type KnowledgeSnapshot,
  type KnowledgeStore,
} from "@seanhogg/builderforce-memory/knowledge";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import { reviewedRoots, rootById, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { log, openRoot, reviewRoot, workspaceFolders, type OpenRoot } from "./knowledgeService";

/** The ONE globalState key recording the packs loaded in this extension (name → record). */
export const KNOWLEDGE_PACKS_KEY = "builderforce.knowledge.packs";

/** A loaded (or created) pack, remembered across sessions. */
export interface KnowledgePackRecord {
  path: string;
  rootId: string;
  loadedAt: string;
}

const PACK_FILTER: Record<string, string[]> = { [vscode.l10n.t("Knowledge Pack")]: ["bfpack"] };

function loadedPacks(state: vscode.Memento): Record<string, KnowledgePackRecord> {
  const read = state.get<Record<string, KnowledgePackRecord>>(KNOWLEDGE_PACKS_KEY);
  return read && typeof read === "object" ? { ...read } : {};
}

async function rememberPack(state: vscode.Memento, name: string, record: KnowledgePackRecord): Promise<void> {
  await state.update(KNOWLEDGE_PACKS_KEY, { ...loadedPacks(state), [name]: record });
}

/** The pack library of the workspace folder holding `folderPath` (`<folder>/.builderforce/knowledge/packs`). */
function packLibraryUri(folderPath: string): vscode.Uri {
  return vscode.Uri.file(path.join(folderPath, ".builderforce", "knowledge", "packs"));
}

async function writePackFile(uri: vscode.Uri, pack: PortableKnowledgePack): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializePack(pack), "utf8"));
}

async function readPackFile(uri: vscode.Uri): Promise<PortableKnowledgePack> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return parsePack(Buffer.from(bytes).toString("utf8"));
}

/** The reviewed root's snapshot as its pack payload (scopes, facts, relations, extracted). */
async function snapshotOfStore(
  store: KnowledgeStore,
  rootId: string,
  extracted: KnowledgeSnapshot["extracted"],
): Promise<KnowledgeSnapshot> {
  const [scopes, facts, relations] = await Promise.all([
    store.scopes(),
    store.facts({ rootId }),
    store.relations({ rootId }),
  ]);
  return { version: 1, scopes, facts: { [rootId]: facts }, relations: { [rootId]: relations }, extracted };
}

/** The extracted cache of a root's snapshot file (`extracted` is keyed by content hash). */
async function extractedOf(open: OpenRoot, rootId: string): Promise<KnowledgeSnapshot["extracted"]> {
  try {
    const text = await open.files.read(snapshotFileName(rootId));
    if (!text) return {};
    const parsed = JSON.parse(text) as Partial<KnowledgeSnapshot>;
    return parsed.extracted && typeof parsed.extracted === "object" ? parsed.extracted : {};
  } catch {
    return {};
  }
}

/**
 * A root's pack from what its reviews left in the store: the snapshot plus the retrieval
 * cards of its stored graph (when the graph builds — a never-reviewed root has none).
 */
async function packOfRoot(
  context: vscode.ExtensionContext,
  root: KnowledgeRoot,
  name: string,
): Promise<{ pack: PortableKnowledgePack; open: OpenRoot }> {
  const open = openRoot(context.secrets, root);
  const extracted = await extractedOf(open, root.rootId);
  const snapshot = await snapshotOfStore(open.store, root.rootId, extracted);
  let cards: IndexDoc[] | undefined;
  try {
    const graph = await buildStoredGraph({
      rootId: root.rootId,
      store: open.store,
      manifest: open.manifest,
      packs: reviewPacks({}),
    });
    if (graph) cards = toCards(graph);
  } catch (error) {
    log(`pack cards ${root.rootId}`, error);
  }
  return {
    pack: packFromSnapshot({ name, rootId: root.rootId, title: root.title, snapshot, ...(cards ? { cards } : {}) }),
    open,
  };
}

/** A pack's snapshot in an in-memory snapshot store, and its graph built from it. */
async function graphOfPack(pack: PortableKnowledgePack) {
  let text = serializePack(pack);
  const store = localSnapshotStore({
    read: () => Promise.resolve(JSON.stringify(pack.snapshot)),
    write: (next) => {
      text = next;
      return Promise.resolve();
    },
  });
  const manifest = fileManifest({ read: () => Promise.resolve(undefined), write: () => Promise.resolve() }, "pack.manifest.json");
  const graph = await buildStoredGraph({ rootId: pack.rootId, store, manifest, packs: reviewPacks({}) });
  return { graph, store };
}

/** Makes a pack queryable: its graph (rebuilt from its snapshot) feeds the host knowledge index. Idempotent. */
async function indexPack(pack: PortableKnowledgePack): Promise<number> {
  const { graph } = await graphOfPack(pack);
  if (!graph) return 0;
  const index = await getHostKnowledgeIndex(pack.rootId);
  await index.upsertFromGraph(graph);
  return graph.nodes.length;
}

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

/** A `withProgress` review of `root`: plan, then run on that plan. */
async function reviewWithProgress(
  context: vscode.ExtensionContext,
  root: KnowledgeRoot,
  title: string,
): Promise<{ report: { extracted: number; factsWritten: number; relationsWritten: number } } | undefined> {
  const review = reviewRoot(context.secrets, root);
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    async (progress) => {
      progress.report({ message: vscode.l10n.t("Planning…") });
      const plan = await review.plan();
      const report = await review.run({
        plan,
        onProgress: (p) => progress.report({ message: `${p.phase} ${p.done}/${p.total}` }),
      });
      return { report };
    },
  );
}

async function createKnowledgePack(context: vscode.ExtensionContext, uri?: unknown): Promise<void> {
  const target = await folderToPack(uri);
  if (!target) return;
  const folders = workspaceFolders();
  const root = rootForPath(target.fsPath, folders);
  if (!root) {
    void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce packs folders inside the open workspace."));
    return;
  }
  const name = root.title || "knowledge";
  const reviewed = await reviewWithProgress(
    context,
    root,
    vscode.l10n.t("BuilderForce: reviewing {0} for the knowledge pack…", root.title),
  );
  if (!reviewed) return;
  const { pack } = await packOfRoot(context, root, name);
  const uriOut = vscode.Uri.file(path.join(packLibraryUri(root.folderPath).fsPath, `${name}.bfpack`));
  await writePackFile(uriOut, pack);
  await rememberPack(context.globalState, name, { path: uriOut.fsPath, rootId: pack.rootId, loadedAt: pack.createdAt });
  void vscode.window.showInformationMessage(
    vscode.l10n.t(
      "BuilderForce: knowledge pack \"{0}\" written to {1} ({2} sources, {3} facts, {4} relations).",
      name,
      uriOut.fsPath,
      reviewed.report.extracted,
      reviewed.report.factsWritten,
      reviewed.report.relationsWritten,
    ),
  );
}

/** The pack to export: an in-library one when picked, else the pack of a reviewed root. */
async function pickExportSource(
  context: vscode.ExtensionContext,
): Promise<{ pack: PortableKnowledgePack; defaultName: string } | undefined> {
  const packs = loadedPacks(context.globalState);
  const roots = reviewedRoots(context.workspaceState)
    .map((id) => rootById(id, workspaceFolders()))
    .filter((r): r is KnowledgeRoot => !!r);
  interface PackPick extends vscode.QuickPickItem { packName?: string; root?: KnowledgeRoot }
  const picks: PackPick[] = [
    ...Object.keys(packs).sort().map((packName): PackPick => ({
      label: packName,
      description: packs[packName]!.path,
      packName,
    })),
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
  if (picked.packName) {
    try {
      return { pack: await readPackFile(vscode.Uri.file(packs[picked.packName]!.path)), defaultName: picked.packName };
    } catch (error) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t("BuilderForce: could not read the pack: {0}", error instanceof Error ? error.message : String(error)),
      );
      return undefined;
    }
  }
  const root = picked.root!;
  const { pack } = await packOfRoot(context, root, root.title || "knowledge");
  return { pack, defaultName: root.title || "knowledge" };
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
  const out = target.fsPath.toLowerCase().endsWith(".bfpack") ? target : vscode.Uri.file(`${target.fsPath}.bfpack`);
  await writePackFile(out, source.pack);
  void vscode.window.showInformationMessage(
    vscode.l10n.t("BuilderForce: knowledge pack \"{0}\" exported to {1}.", source.pack.name, out.fsPath),
  );
}

async function loadKnowledgePack(context: vscode.ExtensionContext): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: PACK_FILTER,
    openLabel: vscode.l10n.t("Load Knowledge Pack"),
  });
  const uri = picked?.[0];
  if (!uri) return;
  let pack: PortableKnowledgePack;
  try {
    pack = await readPackFile(uri);
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("BuilderForce: {0}", error instanceof Error ? error.message : String(error)),
    );
    return;
  }
  let nodes = 0;
  try {
    nodes = await indexPack(pack);
  } catch (error) {
    log(`pack index ${pack.rootId}`, error);
  }
  await rememberPack(context.globalState, pack.name, { path: uri.fsPath, rootId: pack.rootId, loadedAt: new Date().toISOString() });
  void vscode.window.showInformationMessage(
    vscode.l10n.t(
      "BuilderForce: knowledge pack \"{0}\" loaded ({1} facts, {2} relations, {3} cards indexed).",
      pack.name,
      pack.snapshot.facts[pack.rootId]?.length ?? 0,
      pack.snapshot.relations[pack.rootId]?.length ?? 0,
      nodes,
    ),
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

async function updateKnowledgePack(context: vscode.ExtensionContext): Promise<void> {
  const packs = loadedPacks(context.globalState);
  const names = Object.keys(packs).sort();
  let name: string | undefined;
  if (names.length > 0) {
    name = await vscode.window.showQuickPick(names, {
      placeHolder: vscode.l10n.t("Choose the knowledge pack to update"),
    });
  } else {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: PACK_FILTER,
      openLabel: vscode.l10n.t("Update Knowledge Pack"),
    });
    if (picked?.[0]) {
      name = path.basename(picked[0].fsPath).replace(/\.bfpack$/i, "");
      packs[name] = { path: picked[0].fsPath, rootId: "", loadedAt: "" };
    }
  }
  if (!name) return;
  let pack: PortableKnowledgePack;
  try {
    pack = await readPackFile(vscode.Uri.file(packs[name]!.path));
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("BuilderForce: could not read the pack: {0}", error instanceof Error ? error.message : String(error)),
    );
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
  const before = {
    facts: pack.snapshot.facts[pack.rootId]?.length ?? 0,
    relations: pack.snapshot.relations[pack.rootId]?.length ?? 0,
  };
  const reviewed = await reviewWithProgress(
    context,
    root,
    vscode.l10n.t("BuilderForce: re-reviewing {0} for the knowledge pack…", root.title),
  );
  if (!reviewed) return;
  const { pack: fresh } = await packOfRoot(context, root, pack.name);
  const merged = mergePacks(pack, fresh);
  await writePackFile(vscode.Uri.file(packs[name]!.path), merged);
  try {
    await indexPack(merged);
  } catch (error) {
    log(`pack index ${merged.rootId}`, error);
  }
  await rememberPack(context.globalState, name, {
    path: packs[name]!.path,
    rootId: merged.rootId,
    loadedAt: new Date().toISOString(),
  });
  const after = {
    facts: merged.snapshot.facts[merged.rootId]?.length ?? 0,
    relations: merged.snapshot.relations[merged.rootId]?.length ?? 0,
  };
  void vscode.window.showInformationMessage(
    vscode.l10n.t(
      "BuilderForce: knowledge pack \"{0}\" updated — facts {1} → {2}, relations {3} → {4}.",
      name,
      before.facts,
      after.facts,
      before.relations,
      after.relations,
    ),
  );
}

/** The four portable-pack commands (PRD 40), in `registerKnowledgeCommands`' style. */
export function registerKnowledgePackCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("builderforce.createKnowledgePack", (uri?: unknown) => createKnowledgePack(context, uri)),
    vscode.commands.registerCommand("builderforce.exportKnowledgePack", () => exportKnowledgePack(context)),
    vscode.commands.registerCommand("builderforce.loadKnowledgePack", () => loadKnowledgePack(context)),
    vscode.commands.registerCommand("builderforce.updateKnowledgePack", () => updateKnowledgePack(context)),
  );
}
