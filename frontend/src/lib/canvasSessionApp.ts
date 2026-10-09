/**
 * The session's APP — which Builder object the canvas App surface runs, and where its
 * files live.
 *
 * ── ONE APP PER SESSION, MANY BUILDS ON THE BOARD ────────────────────────────────
 * A board can hold several Builder objects. The App surface runs ONE of them: the one
 * flagged `appPrimary`, or the first if none is. The flag lives on the card — one fact in
 * one place, no session column — and {@link withPrimaryApp} is its only writer, so two
 * cards can never both claim it. The surface shows a switcher only when there is a
 * second app to switch to.
 *
 * ── TWO KINDS OF APP, ONE SHAPE ──────────────────────────────────────────────────
 * A signed-in board's app is a durable storage project (`canvasBuildBinding`). A board
 * with no account yet runs the same workspace over files held in this browser, keyed by
 * `localAppKey` on the card. "Keep your work" claims the board, and the App surface then
 * provisions a real project and uploads those files (`useCanvasSessionApp`). Everything
 * downstream — the workspace, the Brain's build tools — reads a {@link SessionApp} and
 * its `store`, and never asks which kind it has.
 *
 * ── THE BOARD'S CODE CARDS ───────────────────────────────────────────────────────
 * Code cards are brought into the app silently, every time App opens, when they are new
 * or changed since the last time ({@link pendingCardImport}). The card keeps a hash of
 * what was brought in, so a card that has not changed is never written twice and an edit
 * made in the workspace is not overwritten by a card nobody touched.
 */
import { canvasBuildBinding, type CanvasBuildBinding } from './canvasBuild';
import { canvasAppEntry, canvasAppFiles } from './canvasApp';
import { hashString } from './hashString';
import { getModality, type ProjectModality } from './modality';
import type { BoundCanvasBuild } from './canvasBuildTools';
import { localFileStore } from './workspace/localFileStore';
import { serverFileStore, type WorkspaceFileStore } from './workspace/workspaceFileStore';

/** Card fields this module owns. */
export const APP_PRIMARY_FIELD = 'appPrimary';
export const LOCAL_APP_KEY_FIELD = 'localAppKey';
export const APP_IMPORT_HASH_FIELD = 'appImportHash';
/** The app a LENS made before the first turn (`useCanvasEntryApp`) — a guess at the
 *  platform, made before anyone said which. See {@link newAppTakesPrimary}. */
export const APP_STARTER_FIELD = 'appStarter';

type BoardNode = { id: string; data: { [key: string]: unknown; kind: string } };

export interface SessionApp {
  nodeId: string;
  title: string;
  modality: ProjectModality;
  /** The durable project, once there is one. */
  binding: CanvasBuildBinding | null;
  /** The browser-held workspace key, while there is no durable project. */
  localKey: string | null;
  store: WorkspaceFileStore;
  primary: boolean;
  /** Made by a lens on entry, not asked for ({@link APP_STARTER_FIELD}). */
  starter: boolean;
}

/**
 * One store object per workspace for the life of the tab. The workspace hooks depend on
 * the store's identity, so re-creating it on every board change would restart them.
 */
const stores = new Map<string, WorkspaceFileStore>();

function storeFor(binding: CanvasBuildBinding | null, localKey: string | null): WorkspaceFileStore | null {
  const key = binding ? `server:${binding.storageProjectId}` : localKey ? `local:${localKey}` : null;
  if (!key) return null;
  const existing = stores.get(key);
  if (existing) return existing;
  const created = binding ? serverFileStore(binding.storageProjectId) : localFileStore(localKey!);
  stores.set(key, created);
  return created;
}

/** The key of the workspace this card holds in the browser, while it has no project. */
export function canvasAppLocalKey(data: { [key: string]: unknown }): string | null {
  const value = data[LOCAL_APP_KEY_FIELD];
  return typeof value === 'string' && value ? value : null;
}

/** Every Builder object on the board that has a workspace behind it, in board order. */
export function sessionApps(nodes: ReadonlyArray<BoardNode>): SessionApp[] {
  const apps: SessionApp[] = [];
  for (const node of nodes) {
    if (node.data.kind !== 'build') continue;
    const binding = canvasBuildBinding(node.data as Parameters<typeof canvasBuildBinding>[0]);
    const localKey = binding ? null : canvasAppLocalKey(node.data);
    const store = storeFor(binding, localKey);
    if (!store) continue;
    apps.push({
      nodeId: node.id,
      title: typeof node.data.title === 'string' && node.data.title.trim() ? node.data.title.trim() : 'App',
      modality: binding?.modality ?? getModality(typeof node.data.modality === 'string' ? node.data.modality : null).id,
      binding,
      localKey,
      store,
      primary: node.data[APP_PRIMARY_FIELD] === true,
      starter: node.data[APP_STARTER_FIELD] === true,
    });
  }
  return apps;
}

/** The app the App surface runs: the flagged one, otherwise the first. */
export function primarySessionApp(apps: readonly SessionApp[]): SessionApp | null {
  return apps.find((app) => app.primary) ?? apps[0] ?? null;
}

/**
 * Whether a NEW app of `modality` becomes the one the App surface runs.
 *
 * The board's first app always does; a second normally does not take over. The exception
 * is a lens's STARTER: Studio makes a web app before the first turn so the turn has a build
 * to write into, but "build me an iPhone app" then makes a React Native build — and the
 * person must see that one, not the empty web starter in front of it. A build of the
 * starter's own platform does not take over (the Brain is told to reuse it instead).
 */
export function newAppTakesPrimary(apps: readonly SessionApp[], modality: ProjectModality): boolean {
  const primary = primarySessionApp(apps);
  return !primary || (primary.starter && primary.modality !== modality);
}

/**
 * The lens's STARTER that a requested app of `modality` takes over instead of landing beside.
 *
 * The starter is the lens's guess at the app, made before the request was read; a build of
 * the SAME platform is that app, so it is claimed (renamed, starter flag dropped) rather
 * than duplicated. Duplicating it is the failure this prevents (session `local-148925cf`):
 * the Brain's `canvas_create_build` added a second website beside the starter, and since a
 * same-platform app never takes primary (`newAppTakesPrimary`), the App surface kept
 * running the untouched starter — any code the Brain wrote would have gone to an app
 * nobody was looking at. A starter of ANOTHER platform is not claimed; that case is
 * `newAppTakesPrimary`'s.
 */
export function claimableStarter(apps: readonly SessionApp[], modality: ProjectModality): SessionApp | null {
  return apps.find((app) => app.starter && app.modality === modality) ?? null;
}

/** The ONE writer of the primary flag: `nodeId` gets it, every other build loses it. */
export function withPrimaryApp<T extends BoardNode>(nodes: readonly T[], nodeId: string): T[] {
  return nodes.map((node) => {
    if (node.data.kind !== 'build') return node;
    const primary = node.id === nodeId;
    if ((node.data[APP_PRIMARY_FIELD] === true) === primary) return node;
    return { ...node, data: { ...node.data, [APP_PRIMARY_FIELD]: primary } };
  });
}

/** The apps as the Brain's build tools address them. */
export function boundCanvasBuilds(apps: readonly SessionApp[]): BoundCanvasBuild[] {
  return apps.map((app) => ({ objectId: app.nodeId, title: app.title, modality: app.modality, store: app.store }));
}

/** True when the board has something the App surface can run: an app, or code cards. */
export function sessionHasApp(nodes: ReadonlyArray<BoardNode>): boolean {
  return sessionApps(nodes).length > 0 || canvasAppEntry(canvasAppFiles(nodes)) !== null;
}

/** A fresh key for a workspace held in this browser. */
export function newLocalAppKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A root page that opens the board's entry page when it does not sit at the root.
 *
 * The runtime serves `index.html` at `/`. A board whose page is `frontend/index.html`
 * would otherwise open the starter page instead of the one the author wrote. A redirect
 * rather than a copy keeps ONE editable source for that page.
 */
export function entryRedirectPage(entryPath: string): string {
  const href = `./${entryPath.replace(/^\.?\//, '')}`;
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${href}"><title>App</title></head>\n<body><script>location.replace(${JSON.stringify(href)});</script></body></html>\n`;
}

/** The card kinds `canvasAppFiles` reads — the only ones whose edits can change the app. */
const APP_CARD_KINDS: ReadonlySet<string> = new Set(['code', 'game', 'website', 'prototype']);

const dataVersions = new WeakMap<object, number>();
let nextDataVersion = 0;

/**
 * A cheap fingerprint of the board's app cards: their ids and the IDENTITY of their data.
 *
 * Moving a card replaces the node but keeps its data object, so dragging cards around
 * leaves this unchanged and costs no import pass — only an actual edit (a new data
 * object) or a card added or removed does. Hashing contents here would re-render every
 * website card on every frame of a drag.
 */
export function appCardSignature(nodes: ReadonlyArray<BoardNode>): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (!APP_CARD_KINDS.has(node.data.kind)) continue;
    let version = dataVersions.get(node.data);
    if (version === undefined) {
      version = ++nextDataVersion;
      dataVersions.set(node.data, version);
    }
    parts.push(`${node.id}:${version}`);
  }
  return parts.join('|');
}

export interface CardImport {
  /** Path → content to write into the app. Empty when nothing changed. */
  files: Record<string, string>;
  /** Card id → the hash to stamp once the files are written. */
  stamps: Record<string, string>;
}

/**
 * What the board's code cards would write into the app, for every card that is new or
 * changed since it was last brought in. Pure: the caller writes, then stamps.
 */
export function pendingCardImport(nodes: ReadonlyArray<BoardNode>): CardImport {
  const all = canvasAppFiles(nodes);
  const byNode = new Map<string, typeof all>();
  for (const file of all) byNode.set(file.nodeId, [...(byNode.get(file.nodeId) ?? []), file]);

  const files: Record<string, string> = {};
  const stamps: Record<string, string> = {};
  for (const node of nodes) {
    const owned = byNode.get(node.id);
    if (!owned) continue;
    const hash = hashString(owned.map((file) => `${file.path}\n${file.source}`).join('\n\0'));
    if (node.data[APP_IMPORT_HASH_FIELD] === hash) continue;
    for (const file of owned) files[file.path] = file.source;
    stamps[node.id] = hash;
  }

  // Only when the entry itself is being brought in: a redirect the person replaced in
  // the workspace must not come back because some other card changed.
  const entry = canvasAppEntry(all);
  if (entry && entry.path !== 'index.html' && stamps[entry.nodeId]) {
    files['index.html'] = entryRedirectPage(entry.path);
  }
  return { files, stamps };
}

/** Stamp the cards whose files were written, so they are not brought in again. */
export function withImportStamps<T extends BoardNode>(nodes: readonly T[], stamps: Record<string, string>): T[] {
  if (!Object.keys(stamps).length) return [...nodes];
  return nodes.map((node) => (stamps[node.id] ? { ...node, data: { ...node.data, [APP_IMPORT_HASH_FIELD]: stamps[node.id] } } : node));
}
