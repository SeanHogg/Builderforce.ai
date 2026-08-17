/**
 * "The manager surface mounts a real `CreationCanvas` session seeded from `pmoApi`,
 * not a bespoke second canvas" — the fix `ROADMAP.md`'s dev-manager canvas review
 * asked for, scoped down from a full replacement of `ManagerCanvas` (a working,
 * tested, hardcoded-panel view with no object model of its own) to what delivers the
 * same value without the blast radius of ripping it out: a real board, seeded on
 * demand from this project's live `pmoApi.rollup`, that a manager can open and keep
 * working on — comments, history, presence, every other canvas kind — none of which
 * the bespoke panel view can ever grow into.
 *
 * Mirrors `buildSalesHubGraph`'s shape exactly (`canvasData.position` +
 * `content` per object, `sourceObjectId`/`targetObjectId` per edge) — the same
 * "provision, seed, open" launcher pattern `SalesCanvasLauncher` already proved.
 */

import type { CreationGraphInput, PmoRollup } from '@/lib/builderforceApi';

export function buildManagerDeliveryGraph(input: {
  projectId: number;
  managerName: string;
  managerType: string;
  rollup: PmoRollup;
}): CreationGraphInput {
  const { rollup } = input;
  const rollupId = crypto.randomUUID();
  const managerId = crypto.randomUUID();
  const objects: CreationGraphInput['objects'] = [
    {
      id: rollupId,
      kind: 'deliveryRollup',
      canvasData: { position: { x: 0, y: 0 } },
      content: {
        kind: 'deliveryRollup', title: rollup.scope.name || 'Delivery rollup', status: 'Live',
        scopeKind: 'project', scopeId: String(input.projectId),
        totalTasks: rollup.delivery.totalTasks, completedCount: rollup.delivery.completedCount, openCount: rollup.delivery.openCount,
        avgCycleTimeHours: rollup.delivery.avgCycleTimeHours, throughputPerWeek: rollup.delivery.throughputPerWeek,
        agentLlmCostUsd: rollup.spend.agentLlmCostUsd,
        deploymentFrequencyPerDay: rollup.dora.deploymentFrequencyPerDay, leadTimeHours: rollup.dora.leadTimeHours,
        changeFailureRatePct: rollup.dora.changeFailureRatePct, mttrHours: rollup.dora.mttrHours,
        avgOkrProgress: rollup.okr.avgProgress, fetchedAt: new Date().toISOString(),
      },
    },
    {
      id: managerId,
      kind: 'agent',
      canvasData: { position: { x: 460, y: 0 } },
      content: {
        kind: 'agent', title: input.managerName, role: input.managerType,
        status: 'Managing this board',
        subtitle: 'Reads the delivery rollup beside it and the tasks on this board — ask it what needs attention.',
      },
    },
  ];
  const connections: CreationGraphInput['connections'] = [
    { id: crypto.randomUUID(), sourceObjectId: managerId, targetObjectId: rollupId, kind: 'reference', label: 'manages' },
  ];
  return { objects, connections };
}
