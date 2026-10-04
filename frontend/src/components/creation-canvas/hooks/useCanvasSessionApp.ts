import { useCallback, useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { scaffoldForModality } from '@builderforce/ide-templates';
import { canvasBuildPatch, createCanvasBuild } from '@/lib/canvasBuild';
import type { BoundCanvasBuild } from '@/lib/canvasBuildTools';
import {
  APP_PRIMARY_FIELD,
  LOCAL_APP_KEY_FIELD,
  boundCanvasBuilds,
  newLocalAppKey,
  pendingCardImport,
  primarySessionApp,
  sessionApps,
  withImportStamps,
  withPrimaryApp,
  type SessionApp,
} from '@/lib/canvasSessionApp';
import { DEFAULT_MODALITY, type ProjectModality } from '@/lib/modality';
import { serverFileStore } from '@/lib/workspace/workspaceFileStore';
import { discardLocalWorkspace, readLocalWorkspace, seedLocalWorkspace } from '@/lib/workspace/localFileStore';
import { notifyWorkspaceFilesChanged } from '@/lib/workspaceFileEvents';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';

/**
 * Open the App surface on a Builder object: make it the session's app, then show it.
 *
 * Separate from {@link useCanvasSessionApp} because it is needed EARLIER — the deep-link
 * effect in the session sync opens a build before the board model (and its stage) exists,
 * and opening one needs nothing but the board setter and the surface.
 */
export function useOpenCanvasApp({ setNodes, showApp }: {
  setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>;
  showApp: () => void;
}): (nodeId: string) => void {
  return useCallback((nodeId: string) => {
    setNodes((current) => withPrimaryApp(current, nodeId));
    showApp();
  }, [setNodes, showApp]);
}

export interface CanvasSessionAppActions {
  apps: SessionApp[];
  /** The app the App surface runs. */
  app: SessionApp | null;
  /** The apps as the Brain's build tools address them. Read through a ref by the tools. */
  buildsRef: RefObject<BoundCanvasBuild[]>;
  /** A new Builder object with a workspace behind it — durable, or in this browser. */
  createApp: (input: { title: string; modality: ProjectModality }) => Promise<BoundCanvasBuild>;
  /** Give an existing, unbound Builder object a workspace. */
  provisionApp: (nodeId: string, input: { title: string; modality: ProjectModality; containerProjectId?: number | null }) => Promise<void>;
  /** Make `nodeId` the app the surface runs. */
  selectApp: (nodeId: string) => void;
  /** Bring new or changed code cards into the app. Silent; resolves once written. */
  importCards: (app: SessionApp) => Promise<void>;
}

/**
 * The session's app, as the canvas manages it — creating one, choosing between several,
 * bringing the board's code cards into it, and making a browser-held one durable once the
 * board is claimed. The pure rules are `lib/canvasSessionApp.ts`; this hook only applies
 * them to the live board.
 */
export function useCanvasSessionApp({ nodes, nodesRef, setNodes, stage, placeAppendedRef, persistence }: {
  nodes: CreationFlowNode[];
  nodesRef: RefObject<CreationFlowNode[]>;
  setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>;
  stage: CanvasProposalStage;
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  persistence: 'local' | 'server';
}): CanvasSessionAppActions {
  const apps = useMemo(() => sessionApps(nodes), [nodes]);
  const app = primarySessionApp(apps);
  const buildsRef = useRef<BoundCanvasBuild[]>([]);
  buildsRef.current = useMemo(() => boundCanvasBuilds(apps), [apps]);

  /** The data that gives a card a workspace: a durable project, or one in this browser. */
  const workspaceFor = useCallback(async (input: { title: string; modality: ProjectModality; containerProjectId?: number | null }): Promise<Partial<CreationNodeData>> => {
    if (persistence === 'server') {
      const ide = await createCanvasBuild({ title: input.title, modality: input.modality, containerProjectId: input.containerProjectId });
      return { ...canvasBuildPatch(ide), title: input.title };
    }
    const key = newLocalAppKey();
    await seedLocalWorkspace(key, scaffoldForModality(input.modality) ?? scaffoldForModality(DEFAULT_MODALITY) ?? {});
    return { title: input.title, modality: input.modality, [LOCAL_APP_KEY_FIELD]: key, status: 'Workspace ready' };
  }, [persistence]);

  const createApp = useCallback(async (input: { title: string; modality: ProjectModality }): Promise<BoundCanvasBuild> => {
    const node = stage.createObject('build');
    const patch = await workspaceFor(input);
    // The first app on a board is the one the surface runs; a second does not take over.
    const first = sessionApps(nodesRef.current ?? []).length === 0;
    node.data = { ...node.data, ...patch, ...(first ? { [APP_PRIMARY_FIELD]: true } : {}) };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node as CreationFlowNode])]);
    const created = boundCanvasBuilds(sessionApps([node as CreationFlowNode]))[0];
    if (!created) throw new Error('The workspace was created but could not be bound to the board.');
    return created;
  }, [nodesRef, placeAppendedRef, setNodes, stage, workspaceFor]);

  const provisionApp = useCallback(async (nodeId: string, input: { title: string; modality: ProjectModality; containerProjectId?: number | null }) => {
    const patch = await workspaceFor(input);
    setNodes((current) => withPrimaryApp(current.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node)), nodeId));
  }, [setNodes, workspaceFor]);

  const selectApp = useCallback((nodeId: string) => {
    setNodes((current) => withPrimaryApp(current, nodeId));
  }, [setNodes]);

  const importing = useRef(false);
  const importCards = useCallback(async (target: SessionApp) => {
    if (importing.current) return;
    const pending = pendingCardImport(nodesRef.current ?? []);
    const paths = Object.keys(pending.files);
    if (!paths.length) return;
    importing.current = true;
    try {
      await Promise.all(paths.map((path) => target.store.write(path, pending.files[path])));
      notifyWorkspaceFilesChanged(target.store.id, paths);
      setNodes((current) => withImportStamps(current, pending.stamps));
    } catch {
      // Unstamped cards are simply brought in on the next open; nothing is lost.
    } finally {
      importing.current = false;
    }
  }, [nodesRef, setNodes]);

  // "Keep your work" made this board durable. An app still held in this browser now gets
  // a real project, its files go up, and the browser copy is dropped — once per app.
  const promoting = useRef(new Set<string>());
  useEffect(() => {
    if (persistence !== 'server') return;
    for (const candidate of apps) {
      if (!candidate.localKey || promoting.current.has(candidate.nodeId)) continue;
      const { nodeId, localKey, title, modality } = candidate;
      promoting.current.add(nodeId);
      void (async () => {
        const files = await readLocalWorkspace(localKey);
        const ide = await createCanvasBuild({ title, modality });
        const durable = serverFileStore(ide.storageProjectId);
        await Promise.all(Object.entries(files).map(([path, content]) => durable.write(path, content)));
        setNodes((current) => current.map((node) => (node.id === nodeId
          ? { ...node, data: { ...node.data, ...canvasBuildPatch(ide), title, [LOCAL_APP_KEY_FIELD]: undefined } }
          : node)));
        await discardLocalWorkspace(localKey);
      })().catch(() => {
        // Left local; the next mount retries. The files are still in this browser.
        promoting.current.delete(nodeId);
      });
    }
  }, [apps, persistence, setNodes]);

  return { apps, app, buildsRef, createApp, provisionApp, selectApp, importCards };
}
