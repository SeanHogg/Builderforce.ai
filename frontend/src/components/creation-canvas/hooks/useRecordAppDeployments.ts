/**
 * Keep the board's DEPLOYMENT CARDS in step with where its apps actually run.
 *
 * Two moments put an app's address on the board (`appDeploymentChange` is the rule):
 *   1. A publish from the App surface's Publish panel (`subscribeSitePublished`, which
 *      carries the published site), announced with a notice.
 *   2. An app whose site was ALREADY live when the board opened — published before the
 *      board recorded publishes, or from Studio in another tab. Checked once per app per
 *      mount (`fetchSite`), and only for an app with no deployment card yet, so a board that
 *      already says it is live costs no request.
 *
 * Either way the card is the one `isLiveDeployment` reads, so Run's ✓, Measure's
 * readiness, the Operate surface and the room's ops station all see the app as live.
 */
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import type { Edge } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import { fetchSite } from '@/lib/api';
import { subscribeSitePublished } from '@/lib/sitePublishEvents';
import { appDeploymentChange, appDeploymentNode, type PublishedAppSite } from '@/lib/canvas/appDeployment';
import { sessionApps, type SessionApp } from '@/lib/canvasSessionApp';
import { reportBackgroundFailure } from '@/lib/reportError';
import { newNode } from '../canvasNodeHelpers';
import type { CreationFlowNode } from '../CreationNode';

export interface UseRecordAppDeploymentsDeps {
  /** Off for a viewer who cannot edit — they read the board, they do not write it. */
  editable: boolean;
  edges: Edge[];
  nodes: CreationFlowNode[];
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useRecordAppDeployments({ editable, edges, nodes, placeAppendedRef, setEdges, setNodes, setNotice, t }: UseRecordAppDeploymentsDeps): void {
  const apps = useMemo(() => sessionApps(nodes), [nodes]);

  const record = useEffectEvent((app: SessionApp, site: PublishedAppSite, announce: boolean) => {
    const change = appDeploymentChange(nodes, edges, app.nodeId, site, { now: new Date().toISOString(), title: t('appPublish.deploymentTitle', { app: app.title }) });
    if (!change) return;
    if (change.type === 'update') {
      setNodes((current) => current.map((node) => (node.id === change.deploymentId ? { ...node, data: { ...node.data, ...change.patch } } : node)));
    } else {
      const source = nodes.find((node) => node.id === app.nodeId);
      const card = newNode('deployment', source ? { x: source.position.x + 380, y: source.position.y } : { x: 200, y: 200 });
      card.data = { ...card.data, ...change.data } as CreationFlowNode['data'];
      setNodes((current) => [...current, ...placeAppendedRef.current(current, [card])]);
      setEdges((current) => [...current, { id: crypto.randomUUID(), source: app.nodeId, target: card.id, type: 'smoothstep', label: t('appPublish.edgeLabel'), data: { connectionKind: 'delivery' } }]);
    }
    if (announce) setNotice(t('appPublish.recorded', { url: site.url }));
  });

  const onPublished = useEffectEvent((projectId: number, site: PublishedAppSite) => {
    if (!editable) return;
    const app = apps.find((candidate) => candidate.binding?.storageProjectId === projectId);
    if (app) record(app, site, true);
  });
  useEffect(() => subscribeSitePublished((projectId, site) => onPublished(projectId, { url: site.url, versionToken: site.versionToken })), []);

  // Apps already live before this board recorded publishes — once per app per mount.
  // Keyed on a string of node ids, so dragging a card does not re-run the check.
  const candidateKey = useMemo(() => (editable
    ? apps.filter((app) => app.binding && !appDeploymentNode(nodes, edges, app.nodeId)).map((app) => app.nodeId).join('\u0000')
    : ''), [apps, editable, edges, nodes]);
  const checkedRef = useRef(new Set<number>());
  const checkLiveSites = useEffectEvent(() => {
    for (const app of apps) {
      if (!app.binding || !candidateKey.split('\u0000').includes(app.nodeId)) continue;
      const projectId = app.binding.storageProjectId;
      if (checkedRef.current.has(projectId)) continue;
      checkedRef.current.add(projectId);
      void fetchSite(projectId)
        .then((site) => { if (site) record(app, { url: site.url, versionToken: site.versionToken, publishedAt: site.publishedAt }, false); })
        .catch((error: unknown) => {
          void reportBackgroundFailure({ title: 'CanvasAppSiteCheckFailed', message: error instanceof Error ? error.message : String(error), level: 'warning', context: { appNodeId: app.nodeId } });
        });
    }
  });
  useEffect(() => {
    if (candidateKey) checkLiveSites();
  }, [candidateKey]);
}
