/** Shipping from the board — game, publish and release panels, website publishing, build workspaces. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from 'react';
import { canvasProjectId, canvasProjectPatch, connectedCanvasProjectNode } from '@/lib/canvasProjectRef';
import { gamePayloadFrom } from '@/lib/gameTargets';
import type { CreationFlowNode } from '../CreationNode';
import { buildWebsiteAssets, type CreationDeliverable, withCreationDeliverable } from '@/lib/creationDeliverables';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { createProject, deleteIdeProject, publishSite } from '@/lib/api';
import { embeddedAppsApi } from '@/lib/embeddedApps';
import { newNode } from '../canvasNodeHelpers';
import { addEdge, type Edge } from '@xyflow/react';
import { canvasBuildBinding, canvasBuildModality, canvasBuildPatch, createCanvasBuild } from '@/lib/canvasBuild';
import { faultText } from '@/lib/apiClient';
import type { IdeProject } from '@/lib/types';
import { nextCanvasObjectPosition } from '../creationCanvasLayout';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';
import type { ConfirmFn } from '@/components/ConfirmProvider';
import type { CanvasLayoutViewport } from '@/lib/canvasGridFit';

export interface UseCanvasPublishingDeps {
  confirm: ConfirmFn;
  connectionKind: 'presentation' | 'data' | 'delivery' | 'control' | 'reference' | 'membership' | 'blocks' | 'verifies';
  creatingBuild: boolean;
  edges: Edge[];
  errorText: (error: unknown) => string;
  gameShipFocus: string | null;
  layoutViewportRef: RefObject<() => CanvasLayoutViewport>;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  requireAccount: (action: string, title: string, description: string) => void;
  selectedNode: CanvasObject | null;
  sessionId: string;
  setBuildFocus: Dispatch<SetStateAction<{ nodeId: string; storageProjectId: number; } | null>>;
  setCreatingBuild: Dispatch<SetStateAction<boolean>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setGameShipFocus: Dispatch<SetStateAction<string | null>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPublishFocus: Dispatch<SetStateAction<string | null>>;
  setReleaseFocus: Dispatch<SetStateAction<string | null>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasPublishing({ confirm, connectionKind, creatingBuild, edges, errorText, gameShipFocus, layoutViewportRef, nodes, persistence, placeAppendedRef, requireAccount, selectedNode, sessionId, setBuildFocus, setCreatingBuild, setEdges, setGameShipFocus, setNodes, setNotice, setPublishFocus, setReleaseFocus, setSelectedId, setSelectedIds, t }: UseCanvasPublishingDeps) {
  /**
   * Open the ship-to-device panel for a game object.
   *
   * Guarded here rather than inside the panel so the two things that make it
   * impossible are said in the canvas's own voice: a guest session has no
   * project to write files into, and a game with no connected project has
   * nowhere to publish to. The panel itself stays a pure view of a project.
   */
  const openGamePanel = useCallback((gameId: string) => {
    const target = nodes.find((node) => node.id === gameId && node.data.kind === 'game');
    if (!target) { setNotice(t('game.selectFirst')); return; }
    if (persistence !== 'server') {
      requireAccount('publish', t('game.accountTitle'), t('game.accountBody'));
      return;
    }
    setGameShipFocus(gameId);
  }, [nodes, persistence, requireAccount, t]);

  /**
   * Open the sell-it panel for one object, or for the whole board.
   *
   * Guarded here for the same reason `openGamePanel` is: a guest session has
   * nothing on a server to publish FROM, and the honest place to say so is the
   * canvas rather than a panel that would open onto an error. The panel itself
   * stays a pure view of a saved session.
   */
  const openPublishPanel = useCallback((nodeId?: string) => {
    if (persistence !== 'server' || !sessionId) {
      requireAccount('publish', t('publish.accountTitle'), t('publish.accountBody'));
      return;
    }
    setPublishFocus(nodeId ?? '');
  }, [persistence, requireAccount, sessionId, t]);

  /**
   * Build → Stage → Live for one card.
   *
   * Gated on the same account requirement as publishing, and for the same reason:
   * a release is a snapshot in the object registry, and a board saved only to this
   * device has nowhere to keep one.
   */
  const openReleasesPanel = useCallback((nodeId?: string) => {
    if (persistence !== 'server' || !sessionId) {
      requireAccount('publish', t('publish.accountTitle'), t('publish.accountBody'));
      return;
    }
    setReleaseFocus(nodeId ?? '');
  }, [persistence, requireAccount, sessionId, t]);

  /** The project a game ships into, and the game as it stands right now. */
  const gamePanelTarget = useMemo(() => {
    const target = gameShipFocus ? nodes.find((node) => node.id === gameShipFocus) : null;
    if (!target) return null;
    const connectedProject = connectedCanvasProjectNode(nodes, edges, target.id);
    return {
      projectId: connectedProject ? canvasProjectId(connectedProject.data) : null,
      game: gamePayloadFrom(target.data),
    };
  }, [edges, gameShipFocus, nodes]);

  /** The publish itself, once the target project is known. Split from
   *  `publishWebsite` so provisioning a project on demand does not fork the
   *  delivery/outcome bookkeeping into a second copy. */
  const publishWebsiteTo = useCallback((target: CreationFlowNode, projectId: number) => {
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const started: CreationDeliverable = { id: deliveryId, action: 'publish', artifactKind: 'website', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-sites', resourceRef: `project:${projectId}` };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publishing…', deliverables: withCreationDeliverable(node.data, started) } } : node));
    void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'started', artifactId: target.id, projectId: Number(projectId) }).catch(() => undefined);
    const subdomain = typeof target.data.subdomain === 'string' ? target.data.subdomain : undefined;
    return publishSite(projectId, buildWebsiteAssets(target.data), subdomain).then((site) => {
      const delivered: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), url: site.url, pathUrl: site.pathUrl, mimeType: 'text/html', resourceRef: `site:${site.subdomain}`, validation: { status: 'passed', detail: `${site.assetCount} assets published (${site.totalBytes} bytes)` }, metadata: { versionToken: site.versionToken, assetCount: site.assetCount, totalBytes: site.totalBytes } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Published', url: site.url, siteUrl: site.url, pathUrl: site.pathUrl, subdomain: site.subdomain, deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      setNotice(t('noticeWebsitePublished', { url: site.url }));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'succeeded', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { url: site.url, versionToken: site.versionToken } }).catch(() => undefined);
    }).catch((error) => {
      const message = errorText(error);
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publish failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'failed', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [errorText, sessionId, setNodes, t]);

  /**
   * The canonical project an object acts against, PROVISIONING one when the board
   * has none yet.
   *
   * Brain authors a Website end to end and never creates a Project object, so
   * Publish used to dead-end on `noticeConnectWebsite` — naming a connection the
   * user had no way to know they needed, on the flagship Idea→Real demo. Publishing
   * is precisely the moment a board earns a real tenant project, so one is created
   * here and placed on the board as a canonical `project` object wired to the source,
   * which means every LATER action (including the second publish) resolves it through
   * `connectedCanvasProjectNode` the ordinary way and no second project is created.
   * Callers gate on `persistence === 'server'` first: an anonymous canvas has no
   * tenant to provision into.
   */
  const ensureCanvasProject = useCallback(async (sourceId: string, name: string): Promise<number> => {
    const connected = connectedCanvasProjectNode(nodes, edges, sourceId);
    const connectedId = connected ? canvasProjectId(connected.data) : null;
    if (connectedId != null) return connectedId;
    const source = nodes.find((node) => node.id === sourceId);
    // THE BOARD MAY ALREADY BE A PROJECT. "Make this a project" writes the identity
    // link and claims the address — so a board that had just been converted looked
    // project-less here and the very next publish provisioned a SECOND project and
    // shipped the site to an address the creator never chose. The link is READ
    // (cached, and invalidated by the conversion itself) rather than inferred from
    // what happens to be drawn on the board.
    //
    // NO CARD IS DRAWN on this branch: conversion places the project card server-side
    // (`placeCanvasObject`) and this board adopts it live. Drawing a second one here
    // would race that adoption for the same resource.
    const appProject = await embeddedAppsApi.sessionAppState(sessionId)
      .then((state) => state.app)
      .catch(() => null);
    if (appProject) return appProject.projectId;
    const project = await createProject({ name: name.trim().slice(0, 120) || 'Untitled project', origin: 'canvas' });
    // Left of the object it serves, so the edge reads container → thing, and far
    // enough out that the two cards do not overlap on a fresh board.
    const node = newNode('project', source ? { x: source.position.x - 380, y: source.position.y } : { x: 200, y: 200 });
    node.data = { ...node.data, ...canvasProjectPatch(project) };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setEdges((current) => addEdge({ id: crypto.randomUUID(), source: node.id, target: sourceId, type: connectionKind }, current));
    return project.id;
  }, [connectionKind, edges, nodes, sessionId, setEdges, setNodes]);

  const publishWebsite = useCallback((websiteId?: string) => {
    const target = nodes.find((node) => node.id === websiteId && node.data.kind === 'website')
      ?? (selectedNode?.data.kind === 'website' ? selectedNode : nodes.find((node) => node.data.kind === 'website'));
    if (!target) { setNotice(t('noticeNeedWebsite')); return; }
    if (persistence !== 'server') { requireAccount('publish', 'Create an account to publish', 'Save this session to publish the Website as a live Builderforce site.'); return; }
    setNotice(t('noticePublishingWebsite'));
    void ensureCanvasProject(target.id, target.data.title)
      .then((projectId) => publishWebsiteTo(target, projectId))
      .catch((error) => {
        const message = error instanceof Error ? error.message : t('noticeWebsiteProjectFailed');
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publish failed' } } : node));
        setNotice(message);
      });
  }, [ensureCanvasProject, nodes, persistence, publishWebsiteTo, requireAccount, selectedNode, setNodes, t]);

  /**
   * Open a Builder object's workspace on the board, creating its backing legacy
   * build record first when the object is not bound yet. Creation goes through
   * the existing `/api/ide-projects` compatibility route, so the workspace is
   * seeded with its modality's starter template and opens runnable — the
   * in-browser website/app builder, on the canvas.
   */
  const openBuild = useCallback((buildId?: string) => {
    const target = nodes.find((node) => node.id === buildId && node.data.kind === 'build')
      ?? (selectedNode?.data.kind === 'build' ? selectedNode : nodes.find((node) => node.data.kind === 'build'));
    if (!target) { setNotice(t('build.selectFirst')); return; }
    const bound = canvasBuildBinding(target.data);
    if (bound) { setBuildFocus({ nodeId: target.id, storageProjectId: bound.storageProjectId }); return; }
    if (persistence !== 'server') { requireAccount('open', t('build.gateTitle'), t('build.gateDescription')); return; }
    if (creatingBuild) return;
    setCreatingBuild(true);
    setNotice(t('build.creating'));
    const container = connectedCanvasProjectNode(nodes, edges, target.id);
    void createCanvasBuild({
      title: target.data.title,
      modality: canvasBuildModality(target.data),
      containerProjectId: container ? canvasProjectId(container.data) : null,
    })
      .then((ide) => {
        const patch = canvasBuildPatch(ide);
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, ...patch } } : node));
        setBuildFocus({ nodeId: target.id, storageProjectId: ide.storageProjectId });
        setNotice(t('build.created'));
      })
      .catch((error) => setNotice(faultText(error, t('build.createFailed'))))
      .finally(() => setCreatingBuild(false));
  }, [creatingBuild, edges, nodes, persistence, requireAccount, selectedNode, setNodes, t]);

  /** Bind a Builder object to a legacy build record that already exists, instead of
   *  provisioning a second workspace for work that is already under way. */
  const attachBuild = useCallback((nodeId: string, ide: IdeProject) => {
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...canvasBuildPatch(ide) } } : node));
    setBuildFocus({ nodeId, storageProjectId: ide.storageProjectId });
    setNotice(t('build.attached'));
  }, [setNodes, t]);

  /**
   * Delete the build record a Builder object provisioned, and return the object to
   * its unbound state. Removing the OBJECT deliberately leaves the workspace alone
   * — a build record is a first-class child of a Project and outlives the session
   * that spawned it — so this is the explicit way to discard the files too.
   */
  const deleteBuildWorkspace = useCallback(async (nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    const binding = target ? canvasBuildBinding(target.data) : null;
    if (!target || !binding) return;
    if (!(await confirm({ message: t('build.deleteConfirm', { title: target.data.title }), destructive: true }))) return;
    try {
      await deleteIdeProject(binding.ideProjectId);
      setBuildFocus((current) => current?.nodeId === nodeId ? null : current);
      setNodes((current) => current.map((node) => node.id === nodeId
        ? { ...node, data: { ...node.data, resourceId: undefined, ideProjectId: undefined, storageProjectId: undefined, storageProjectPublicId: undefined, siteUrl: undefined, url: undefined, pathUrl: undefined, status: 'Not created' } }
        : node));
      setNotice(t('build.workspaceDeleted'));
    } catch (error) {
      setNotice(faultText(error, t('build.deleteWorkspaceFailed')));
    }
  }, [confirm, nodes, setNodes, t]);

  /**
   * Grow an authored Website object into a real codebase: add a Builder object
   * beside it, connect the two, and open the workspace. The static site stays
   * publishable while the code project takes over — no object loses its contract.
   */
  const buildWebsiteWithCode = useCallback((websiteId: string) => {
    const source = nodes.find((node) => node.id === websiteId);
    if (!source) return;
    const existing = nodes.find((node) => node.data.kind === 'build'
      && edges.some((edge) => (edge.source === websiteId && edge.target === node.id) || (edge.target === websiteId && edge.source === node.id)));
    if (existing) { openBuild(existing.id); return; }
    const build = newNode('build', nextCanvasObjectPosition(nodes, { x: source.position.x + 520, y: source.position.y }, layoutViewportRef.current(), 'build'));
    build.data = { ...build.data, title: source.data.title, modality: canvasBuildModality(source.data) };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [build])]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: websiteId, target: build.id, type: 'smoothstep', label: t('build.edgeLabel'), data: { connectionKind: 'delivery' } }]);
    setSelectedId(build.id);
    setSelectedIds([build.id]);
    setNotice(t('build.addedFromWebsite'));
  }, [edges, nodes, openBuild, setEdges, setNodes, t]);
  return { publishWebsite, openBuild, openReleasesPanel, attachBuild, deleteBuildWorkspace, buildWebsiteWithCode, openGamePanel, openPublishPanel, gamePanelTarget };
}
