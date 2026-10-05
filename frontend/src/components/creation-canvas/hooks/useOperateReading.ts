/**
 * What the Operate surface reads off the board: deployments, releases and the app.
 *
 * Every input is already on the board — `boardDeployments` (the one deployment reader),
 * `release` cards, and the session's primary app (`primarySessionApp`), whose durable
 * project id is what the People section (`OperatePeopleSection`) reads its site
 * audience by. Nothing here talks to the API; the releases LIFECYCLE (stage → live) stays in `CanvasReleasesPanel`,
 * which this surface opens rather than re-implements.
 */
import { useMemo } from 'react';
import { boardDeployments, type BoardDeployment } from '@/lib/canvas/boardDeployments';
import { primarySessionApp, sessionApps, sessionHasApp } from '@/lib/canvasSessionApp';
import type { CreationFlowNode } from '../CreationNode';

export interface OperateRelease {
  id: string;
  title: string;
  status: string | null;
}

export interface OperateReading {
  deployments: BoardDeployment[];
  live: boolean;
  releases: OperateRelease[];
  /** The app the App surface runs, or null when the board has none. `projectId` is its
   *  durable project (`binding.ideProjectId`) — null while it is still a local workspace. */
  app: { nodeId: string; title: string; projectId: number | null } | null;
  hasApp: boolean;
}

export function operateReading(nodes: readonly CreationFlowNode[]): OperateReading {
  const deployments = boardDeployments(nodes);
  const primary = primarySessionApp(sessionApps(nodes));
  return {
    deployments,
    live: deployments.some((deployment) => deployment.url !== null),
    releases: nodes
      .filter((node) => node.data.kind === 'release')
      .map((node) => ({
        id: node.id,
        title: typeof node.data.title === 'string' ? node.data.title : '',
        status: typeof node.data.status === 'string' && node.data.status ? node.data.status : null,
      })),
    app: primary ? { nodeId: primary.nodeId, title: primary.title, projectId: primary.binding?.ideProjectId ?? null } : null,
    hasApp: sessionHasApp(nodes),
  };
}

export function useOperateReading(nodes: readonly CreationFlowNode[]): OperateReading {
  return useMemo(() => operateReading(nodes), [nodes]);
}
