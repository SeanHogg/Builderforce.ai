/** Shipping from the board — game, publish and release panels, website publishing, build workspaces. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from 'react';
import { canvasProjectId, canvasProjectPatch, connectedCanvasProjectNode } from '@/lib/canvasProjectRef';
import { gamePayloadFrom } from '@/lib/gameTargets';
import type { CreationFlowNode } from '../CreationNode';
import { buildWebsiteAssets, type CreationDeliverable, withCreationDeliverable } from '@/lib/creationDeliverables';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { createProject, publishSite } from '@/lib/api';
import { deleteIdeProject } from '@/lib/ideProjectsApi';
import { embeddedAppsApi } from '@/lib/embeddedApps';
import { newNode } from '../canvasNodeHelpers';
import { addEdge, type Edge } from '@xyflow/react';
import { canvasBuildBinding, canvasBuildModality, canvasBuildPatch } from '@/lib/canvasBuild';
import { canvasAppLocalKey, LOCAL_APP_KEY_FIELD, sessionApps } from '@/lib/canvasSessionApp';
import { discardLocalWorkspace } from '@/lib/workspace/localFileStore';
import type { CanvasSessionAppActions } from './useCanvasSessionApp';
import { faultText } from '@/lib/apiClient';
import type { IdeProject } from '@/lib/types';
import { nextCanvasObjectPosition } from '../creationCanvasLayout';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';
import type { ConfirmFn } from '@/components/ConfirmProvider';
import type { CanvasLayoutViewport } from '@/lib/canvasGridFit';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';
import { useRecordAppDeployments } from './useRecordAppDeployments';
import { useLatestRef } from './useLatestRef';
import { reportBackgroundFailure } from '@/lib/reportError';

export interface UseCanvasPublishingDeps {
  /** This viewer may change the board — a publish recorded as a deployment card writes it. */
  canEdit: boolean;
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
  /** Show a Builder object's workspace — the App surface, on that object. */
  openApp: (nodeId: string) => void;
  provisionApp: CanvasSessionAppActions['provisionApp'];
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

export function useCanvasPublishing({ canEdit, confirm, connectionKind, creatingBuild, edges, errorText, gameShipFocus, layoutViewportRef, nodes, persistence, placeAppendedRef, requireAccount, selectedNode, sessionId, openApp, provisionApp, setCreatingBuild, setEdges, setGameShipFocus, setNodes, setNotice, setPublishFocus, setReleaseFocus, setSelectedId, setSelectedIds, t }: UseCanvasPublishingDeps) {
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
  }, [nodes, persistence, requireAccount, setGameShipFocus, setNotice, t]);

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
  }, [persistence, requireAccount, sessionId, setPublishFocus, t]);

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
  }, [persistence, requireAccount, sessionId, setReleaseFocus, t]);

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
  }, [errorText, sessionId, setNodes, setNotice, t]);

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
    // Tie the new project to this board BEFORE the publish records outcomes about
    // it. The card drawn below reaches the server only on the next graph save, so
    // the publish's `started` outcome would otherwise name a project the session
    // does not hold yet. Best-effort: a failed link costs attribution, not the publish.
    await creationSessionsApi.linkProject(sessionId, project.id).catch((error: unknown) => {
      void reportBackgroundFailure({
        message: error instanceof Error ? error.message : 'Linking the published project to its board failed',
        level: 'warning',
        context: { sessionId, projectId: project.id },
      });
    });
    // Left of the object it serves, so the edge reads container → thing, and far
    // enough out that the two cards do not overlap on a fresh board.
    const node = newNode('project', source ? { x: source.position.x - 380, y: source.position.y } : { x: 200, y: 200 });
    node.data = { ...node.data, ...canvasProjectPatch(project) };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [node])]);
    setEdges((current) => addEdge({ id: crypto.randomUUID(), source: node.id, target: sourceId, type: connectionKind }, current));
    return project.id;
  }, [connectionKind, edges, nodes, placeAppendedRef, sessionId, setEdges, setNodes]);

  const publishWebsite = useCallback((websiteId?: string) => {
    const target = nodes.find((node) => node.id === websiteId && node.data.kind === 'website')
      ?? (selectedNode?.data.kind === 'website' ? selectedNode : nodes.find((node) => node.data.kind === 'website'));
    if (!target) { setNotice(t('noticeNeedWebsite')); return; }
    if (persistence !== 'server') { requireAccount('publish', t('noticeWebsiteAccountTitle'), t('noticeWebsiteAccountBody')); return; }
    setNotice(t('noticePublishingWebsite'));
    void ensureCanvasProject(target.id, target.data.title)
      .then((projectId) => publishWebsiteTo(target, projectId))
      .catch((error) => {
        const message = error instanceof Error ? error.message : t('noticeWebsiteProjectFailed');
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publish failed' } } : node));
        setNotice(message);
      });
  }, [ensureCanvasProject, nodes, persistence, publishWebsiteTo, requireAccount, selectedNode, setNodes, setNotice, t]);

  /**
   * Open a Builder object's workspace — the App surface, on that object — giving it a
   * workspace first when it has none. A signed-in board gets a durable project through
   * the `/api/ide-projects` compatibility route, seeded with its modality's starter
   * template; a board with no account gets the same starter held in this browser, which
   * "Keep your work" later makes durable. Either way it opens runnable.
   */
  const openBuild = useCallback((buildId?: string) => {
    const target = nodes.find((node) => node.id === buildId && node.data.kind === 'build')
      ?? (selectedNode?.data.kind === 'build' ? selectedNode : nodes.find((node) => node.data.kind === 'build'));
    if (!target) { setNotice(t('build.selectFirst')); return; }
    if (sessionApps([target]).length) { openApp(target.id); return; }
    if (creatingBuild) return;
    setCreatingBuild(true);
    setNotice(t('build.creating'));
    const container = persistence === 'server' ? connectedCanvasProjectNode(nodes, edges, target.id) : null;
    void provisionApp(target.id, {
      title: target.data.title,
      modality: canvasBuildModality(target.data),
      containerProjectId: container ? canvasProjectId(container.data) : null,
    })
      .then(() => {
        openApp(target.id);
        setNotice(t('build.created'));
      })
      .catch((error) => setNotice(faultText(error, t('build.createFailed'))))
      .finally(() => setCreatingBuild(false));
  }, [creatingBuild, edges, nodes, openApp, persistence, provisionApp, selectedNode, setCreatingBuild, setNotice, t]);

  /**
   * Put the app on the web: the App surface, on that app, with ITS Publish panel open —
   * the one place a site is built and published (`SitePublishPanel`), so there is no second
   * publish path to drift from it. The person chooses the address and presses Publish; the
   * deployment card follows on its own (`useRecordAppDeployments`). A board held only in
   * this browser has no project to publish from, so it asks for an account first, in the
   * canvas's own voice. With no app yet, the Builder object is given one.
   */
  const publishAppNow = useCallback((buildId?: string) => {
    const apps = sessionApps(nodes);
    const app = apps.find((candidate) => candidate.nodeId === buildId) ?? apps.find((candidate) => candidate.primary) ?? apps[0];
    if (!app) { openBuild(buildId); return; }
    if (persistence !== 'server' || !app.binding) {
      requireAccount('publish', t('appPublish.accountTitle'), t('appPublish.accountBody'));
      return;
    }
    openApp(app.nodeId);
    sendWorkspaceCommand(app.store.id, { type: 'openTab', tab: 'publish' }, { whenReady: true });
  }, [nodes, openApp, openBuild, persistence, requireAccount, t]);
  // STABLE: the phase context publishes it to every card's lens, and a function that
  // changed with the board would re-render all of them on every drag frame.
  const publishAppRef = useLatestRef(publishAppNow);
  const publishApp = useCallback((buildId?: string) => publishAppRef.current(buildId), [publishAppRef]);

  useRecordAppDeployments({ editable: canEdit, edges, nodes, placeAppendedRef, setEdges, setNodes, setNotice, t });

  /** Bind a Builder object to a legacy build record that already exists, instead of
   *  provisioning a second workspace for work that is already under way. */
  const attachBuild = useCallback((nodeId: string, ide: IdeProject) => {
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...canvasBuildPatch(ide) } } : node));
    openApp(nodeId);
    setNotice(t('build.attached'));
  }, [openApp, setNodes, setNotice, t]);

  /**
   * Delete the build record a Builder object provisioned, and return the object to
   * its unbound state. Removing the OBJECT deliberately leaves the workspace alone
   * — a build record is a first-class child of a Project and outlives the session
   * that spawned it — so this is the explicit way to discard the files too. A workspace
   * held in this browser is discarded the same way, from the browser.
   */
  const deleteBuildWorkspace = useCallback(async (nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    const binding = target ? canvasBuildBinding(target.data) : null;
    const localKey = target && !binding ? canvasAppLocalKey(target.data) : null;
    if (!target || (!binding && !localKey)) return;
    if (!(await confirm({ message: t('build.deleteConfirm', { title: target.data.title }), destructive: true }))) return;
    try {
      if (binding) await deleteIdeProject(binding.ideProjectId);
      else if (localKey) await discardLocalWorkspace(localKey);
      setNodes((current) => current.map((node) => node.id === nodeId
        ? { ...node, data: { ...node.data, resourceId: undefined, ideProjectId: undefined, storageProjectId: undefined, storageProjectPublicId: undefined, siteUrl: undefined, url: undefined, pathUrl: undefined, [LOCAL_APP_KEY_FIELD]: undefined, status: 'Not created' } }
        : node));
      setNotice(t('build.workspaceDeleted'));
    } catch (error) {
      setNotice(faultText(error, t('build.deleteWorkspaceFailed')));
    }
  }, [confirm, nodes, setNodes, setNotice, t]);

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
  }, [edges, layoutViewportRef, nodes, openBuild, placeAppendedRef, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, t]);
  return { publishWebsite, publishApp, openBuild, openReleasesPanel, attachBuild, deleteBuildWorkspace, buildWebsiteWithCode, openGamePanel, openPublishPanel, gamePanelTarget };
}
