import type { CreationFlowNode } from './CreationNode';
import { specsApi } from '@/lib/builderforceApi';
import type { ProjectEvermindContributions, ProjectEvermindHead } from '@/lib/projectEvermindApi';
import type { CreationNodeData } from './types';

export async function persistCanonicalProjectPrd(
  node: CreationFlowNode,
  createSpec: typeof specsApi.create = specsApi.create,
): Promise<CreationFlowNode> {
  const projectId = Number(node.data.sourceProjectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('The reviewed PRD has no canonical project');
  const markdown = String(node.data.markdown || node.data.content || '').trim();
  if (!markdown) throw new Error('The reviewed PRD has no authored content');
  const requestedStatus = String(node.data.status || 'draft');
  const status = (['draft', 'ready', 'in_progress', 'complete'].includes(requestedStatus) ? requestedStatus : 'draft') as 'draft' | 'ready' | 'in_progress' | 'complete';
  const saved = await createSpec({ projectId, goal: node.data.title, prd: markdown, status, kind: 'feature' });
  const { canonicalPrdPending: _pending, ...data } = node.data;
  return { ...node, data: { ...data, resourceId: `spec:${saved.id}`, status: saved.status } };
}

/** Canonical project state rendered over an attached Evermind node. Kept outside the
 * persisted canvas graph so a 20-second live refresh never creates canvas revisions. */
export function projectEvermindNodePatch(head: ProjectEvermindHead, activity: ProjectEvermindContributions): Partial<CreationNodeData> {
  const measuredLoss = activity.training.find((point) => point.loss > 0)?.loss;
  return {
    title: head.name || 'Project Evermind',
    status: head.seeded ? `${head.mode === 'connected' ? 'Learning' : 'Frozen'} · v${head.version}` : 'Ready to seed',
    evermindVersion: head.version,
    evermindSeeded: head.seeded,
    contributions: activity.contributions,
    pendingContributions: activity.pending,
    recentLearnings: activity.recent,
    trainingLoss: measuredLoss,
    learningMode: activity.mode,
    lastLearnedAt: activity.lastLearnedAt,
    quarantinedAt: activity.quarantinedAt ?? head.quarantinedAt,
    quarantineReason: activity.quarantineReason ?? head.quarantineReason,
    evalPoint: activity.eval,
    inferenceEnabled: activity.inferenceEnabled,
    teacherModel: activity.teacherModel || undefined,
    evermindLoading: false,
  };
}
