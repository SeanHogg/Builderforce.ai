/** Project objects — expand, compare, load quality, deliver and expand mockups. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { agileMetricsApi, creationSessionsApi, isAwaitingApprovalExecution, runtimeApi, tasksApi, taskSpecsApi, toolsApi } from '@/lib/builderforceApi';
import type { CreationNodeData, CreationObjectKind } from '../types';
import type { CreationFlowNode } from '../CreationNode';
import { formatResourceRef } from '@builderforce/creation-canvas-contract';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { faultText } from '@/lib/apiClient';
import { createFlowStepData } from '@/domains/workflow/domain/flowStepObject';
import { fetchProjects } from '@/lib/api';
import { computeProjectHealth } from '@/lib/projectHealth';
import { newNode } from '../canvasNodeHelpers';
import { type CreationDeliverable, withCreationDeliverable } from '@/lib/creationDeliverables';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';

export interface UseCanvasProjectActionsDeps {
  errorText: (error: unknown) => string;
  nodes: CanvasObject[];
  openNodeInspector: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null, rect?: DOMRect) => void;
  persistence: 'local' | 'server';
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  requireAccount: (action: string, title: string, description: string) => void;
  selectedNode: CanvasObject | null;
  sessionId: string;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasProjectActions({ errorText, nodes, openNodeInspector, persistence, placeAppendedRef, requireAccount, selectedNode, sessionId, setEdges, setNodes, setNotice, setSelectedId, t }: UseCanvasProjectActionsDeps) {
  const expandProject = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : nodes.find((node) => node.data.kind === 'project');
    if (!project) {
      setNotice(t('noticeAddOrSelectProject'));
      return;
    }
    const projectId = canvasProjectId(project.data);
    if (persistence === 'server' && projectId != null) {
      setNotice(t('noticeLoadingRelationships'));
      const lens = ['delivery', 'metrics', 'customer-feedback'].includes(String(project.data.projectLens))
        ? project.data.projectLens as 'delivery' | 'metrics' | 'customer-feedback'
        : 'everything';
      void creationSessionsApi.expandProject(sessionId, projectId, lens).then(async (expanded) => {
        const taskDetails = new Map<string, CreationNodeData>();
        await Promise.all(expanded.resources.filter((item) => item.kind === 'task' && item.resourceType === 'task').map(async (item) => {
          const taskId = Number(item.resourceId);
          if (!Number.isInteger(taskId) || taskId <= 0) return;
          try {
            const [task, specs] = await Promise.all([tasksApi.get(taskId), taskSpecsApi.list(taskId).catch(() => [])]);
            const primaryPrd = specs.find((spec) => spec.isPrimary) ?? specs[0];
            const agentNode = expanded.resources.find((resource) => resource.kind === 'agent' && String(resource.resourceId) === String(task.assignedAgentRef));
            taskDetails.set(String(item.resourceId), {
              kind: 'task', title: task.title, taskKey: task.key, status: task.status,
              content: task.description || undefined, priority: task.priority,
              agentRef: task.assignedAgentRef || undefined,
              assignee: agentNode?.title || task.assignedAgentRef || (task.assignedUserId ? 'Assigned teammate' : undefined),
              prdTitle: primaryPrd?.goal || undefined, prdStatus: primaryPrd?.status || undefined,
              prdSummary: primaryPrd?.prd?.replace(/[#*_`>\[\]]/g, '').trim().slice(0, 240) || undefined,
              prdCount: specs.length,
            });
          } catch { /* Keep the relationship card available when task detail is inaccessible. */ }
        }));
        const related: CreationFlowNode[] = [
          ...expanded.resources.slice(0, 24).map((item, index): CreationFlowNode => ({
            id: crypto.randomUUID(), type: 'creation',
            position: { x: project.position.x + 390 + (index % 3) * 300, y: project.position.y - 180 + Math.floor(index / 3) * 190 },
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, subtitle: item.subtitle ?? undefined, ...(item.kind === 'task' ? taskDetails.get(String(item.resourceId)) : undefined), resourceId: formatResourceRef(item.resourceType, item.resourceId) ?? undefined, workflowExecutable: item.workflowExecutable, resourceSubtype: item.resourceSubtype },
          })),
          ...expanded.generated.map((item, index): CreationFlowNode => ({
            id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 390 + index * 370, y: project.position.y - 430 },
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, sourceProjectId: projectId, expansionKey: item.key },
          })),
        ];
        const knownResources = new Set(nodes.map((node) => node.data.resourceId).filter(Boolean));
        const knownNative = new Set(nodes.map((node) => String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        const additions = related.filter((node) => node.data.resourceId ? !knownResources.has(node.data.resourceId) : !knownNative.has(String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        setNodes((current) => [...current, ...placeAppendedRef.current(current, additions)]);
        setEdges((current) => [...current, ...additions.map((node) => ({ id: crypto.randomUUID(), source: project.id, target: node.id, type: 'smoothstep', label: node.data.kind }))]);
        setNotice(additions.length ? `${additions.length} related project items added` : t('noticeLensAlreadyExpanded'));
        trackActivity('creation_project_expanded', { sessionId, metadata: { clientSurface: canvasSurface(), projectId } });
      }).catch((error) => setNotice(faultText(error, t('noticeExpandProjectFailed'))));
      return;
    }
    // A SECTION, not a legacy `workflow` card: the canvas IS the workflow. Sized so
    // its steps' centres stay inside it and the 'Next delivery task' card seeded
    // below it stays clear — see `initialNodes`' own frame for the same accounting.
    const deliveryFramePosition = { x: project.position.x + 850, y: project.position.y - 150 };
    // Persisted with the board, so minted in the board's language.
    const projectTitle = project.data.title ?? '';
    const deliveryTitle = t('runtimeObject.deliveryWorkflow');
    const related: CreationFlowNode[] = [
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y - 150 }, data: { kind: 'dashboard', title: t('runtimeObject.projectHealth', { title: projectTitle }) } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y + 100 }, data: { kind: 'roadmap', title: t('runtimeObject.projectRoadmap', { title: projectTitle }), status: t('runtimeObject.status.live') } },
      { id: crypto.randomUUID(), type: 'creation', position: deliveryFramePosition, style: { width: 380, height: 220 }, zIndex: -1, data: { kind: 'frame', title: deliveryTitle, framePurpose: t('flowStep.framePurpose') } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y + 150 }, data: { kind: 'task', title: t('runtimeObject.nextDeliveryTask'), status: t('runtimeObject.status.ready'), role: t('seedBoard.strategist') } },
    ];
    const additions = related.filter((candidate) => !nodes.some((node) => node.data.kind === candidate.data.kind && node.data.title === candidate.data.title));
    // The frame's own steps, added only when the frame itself was — re-expanding an
    // already-present section must not duplicate what is already inside it.
    const deliveryFrame = additions.find((candidate) => candidate.data.kind === 'frame' && candidate.data.title === deliveryTitle);
    const deliveryTrigger: CreationFlowNode | null = deliveryFrame ? { id: crypto.randomUUID(), type: 'creation', position: { x: deliveryFramePosition.x + 30, y: deliveryFramePosition.y + 50 }, style: { width: 140, height: 150 }, data: createFlowStepData('trigger', t('runtimeObject.sprintCadence')) as CreationNodeData } : null;
    const deliveryTask: CreationFlowNode | null = deliveryFrame ? { id: crypto.randomUUID(), type: 'creation', position: { x: deliveryFramePosition.x + 200, y: deliveryFramePosition.y + 50 }, style: { width: 140, height: 150 }, data: createFlowStepData('agent', t('runtimeObject.shipNextTask')) as CreationNodeData } : null;
    const deliverySteps = [deliveryTrigger, deliveryTask].filter((step): step is CreationFlowNode => step !== null);
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [...additions, ...deliverySteps])]);
    setEdges((current) => [
      ...current,
      ...additions.map((candidate) => ({ id: crypto.randomUUID(), source: project.id, target: candidate.id, type: 'smoothstep' })),
      ...(deliveryTrigger && deliveryTask ? [{ id: crypto.randomUUID(), source: deliveryTrigger.id, target: deliveryTask.id, type: 'smoothstep', data: { connectionKind: 'control' } }] : []),
    ]);
    setNotice(t('noticeRelationshipsAdded'));
    trackActivity('creation_project_expanded', { sessionId, metadata: { clientSurface: canvasSurface(), projectId: Number.isInteger(projectId) ? projectId : undefined } });
  }, [nodes, persistence, placeAppendedRef, selectedNode, sessionId, setEdges, setNodes, setNotice, t]);

  const compareProjects = useCallback(() => {
    if (persistence !== 'server') { requireAccount('compare', 'Create an account to compare projects', 'Project comparisons use live tenant projects, delivery metrics, feature evidence, and saved source references.'); return; }
    const projectNodes = canvasProjectNodes(nodes).slice(0, 6);
    if (projectNodes.length < 2) { setNotice(t('noticeNeedTwoProjects')); return; }
    setNotice(t('noticeLoadingEvidence'));
    void fetchProjects().then(async (available) => {
      const byId = new Map(available.map((project) => [project.id, project]));
      const evidence = await Promise.all(projectNodes.map(async (node) => {
        const projectId = canvasProjectId(node.data)!;
        const project = byId.get(projectId);
        if (!project) throw new Error(`Project ${projectId} is no longer accessible`);
        const [velocity, tasks, quality] = await Promise.all([
          agileMetricsApi.derivedVelocity(projectId).catch(() => null),
          tasksApi.list(projectId).catch(() => []),
          toolsApi.projectScore(projectId).catch(() => null),
        ]);
        const health = computeProjectHealth(project);
        const diagnostics = quality?.diagnostics.map((diagnostic) => ({
          toolId: diagnostic.toolId, name: diagnostic.name, icon: diagnostic.icon,
          score: diagnostic.score, scoreLabel: diagnostic.scoreLabel, headline: diagnostic.headline,
          gapCount: diagnostic.gapCount, remediation: diagnostic.remediation,
          recommendations: diagnostic.result.recommendations,
        })) ?? [];
        return {
          projectId, name: project.name, status: project.status || 'active', progress: health.progressPct,
          health: health.healthScore, healthTier: health.tier, open: health.open, blocked: health.blocked,
          overdue: health.overdue, velocity: velocity?.averageVelocity ?? null,
          qualityScore: quality?.result.score ?? null, qualityLabel: quality?.result.scoreLabel ?? null,
          qualityHeadline: quality?.result.headline ?? 'No quality diagnostics have been run', diagnostics,
          diagnosticCount: diagnostics.length, gapCount: diagnostics.reduce((total, diagnostic) => total + diagnostic.gapCount, 0),
          recommendations: diagnostics.flatMap((diagnostic) => diagnostic.recommendations.map((recommendation) => ({ ...recommendation, diagnostic: diagnostic.name, score: diagnostic.score }))).slice(0, 6),
          features: tasks.filter((task) => !['done', 'closed', 'cancelled'].includes(task.status)).slice(0, 5).map((task) => task.title),
        };
      }));
      const comparison = newNode('projectComparison', { x: Math.max(...projectNodes.map((node) => node.position.x)) + 430, y: Math.min(...projectNodes.map((node) => node.position.y)) });
      comparison.data = {
        ...comparison.data, title: `${evidence.map((project) => project.name).join(' vs ')}`, status: 'Live evidence', projects: evidence,
        fetchedAt: new Date().toISOString(), sources: evidence.flatMap((project) => [
          { label: `${project.name} project metrics`, resource: `/api/projects`, projectId: project.projectId },
          { label: `${project.name} velocity`, resource: `/api/agile/velocity/derived?projectId=${project.projectId}`, projectId: project.projectId },
          { label: `${project.name} feature/task evidence`, resource: `/api/tasks?projectId=${project.projectId}`, projectId: project.projectId },
          { label: `${project.name} quality diagnostics`, resource: `/api/tools/projects/${project.projectId}/score`, projectId: project.projectId },
        ]),
      };
      setNodes((current) => [...current.map((node) => {
        const projectId = canvasProjectId(node.data);
        const project = projectId ? evidence.find((candidate) => candidate.projectId === projectId) : null;
        return project ? { ...node, data: { ...node.data, ...project, qualityUpdatedAt: comparison.data.fetchedAt } } : node;
      }), comparison]);
      setEdges((current) => [...current, ...projectNodes.map((project) => ({ id: crypto.randomUUID(), source: project.id, target: comparison.id, label: 'compared in', type: 'smoothstep', animated: true }))]);
      setSelectedId(comparison.id);
      openNodeInspector(comparison.id);
      setNotice(t('noticeComparisonAdded'));
      trackActivity('creation_projects_compared', { sessionId, metadata: { clientSurface: canvasSurface(), projectCount: projectNodes.length } });
    }).catch((error) => setNotice(faultText(error, t('noticeCompareProjectsFailed'))));
  }, [nodes, openNodeInspector, persistence, requireAccount, sessionId, setEdges, setNodes, setNotice, setSelectedId, t]);

  const loadProjectQuality = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : null;
    const projectId = project ? canvasProjectId(project.data) : null;
    if (!project || projectId == null) {
      if (persistence === 'local') requireAccount('diagnostics', 'Create an account to load project quality', 'Quality diagnostics are saved against a canonical project and include current results, gaps, and remediation recommendations.');
      else setNotice(t('noticeAttachForQuality'));
      return;
    }
    const validationCorrelationId = crypto.randomUUID();
    const validationStartedAt = performance.now();
    void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'started', projectId: Number(projectId), artifactId: project.id }).catch(() => undefined);
    setNotice(t('noticeLoadingQuality'));
    void toolsApi.projectScore(Number(projectId)).then((quality) => {
      const diagnostics = quality.diagnostics.map((diagnostic) => ({
        toolId: diagnostic.toolId, name: diagnostic.name, icon: diagnostic.icon,
        score: diagnostic.score, scoreLabel: diagnostic.scoreLabel, headline: diagnostic.headline,
        gapCount: diagnostic.gapCount, remediation: diagnostic.remediation,
        recommendations: diagnostic.result.recommendations,
      }));
      const recommendations = diagnostics.flatMap((diagnostic) => diagnostic.recommendations.map((recommendation) => ({ ...recommendation, diagnostic: diagnostic.name, score: diagnostic.score }))).slice(0, 8);
      const qualityData = {
        qualityScore: quality.result.score, qualityLabel: quality.result.scoreLabel,
        qualityHeadline: quality.result.headline, diagnosticCount: diagnostics.length,
        gapCount: diagnostics.reduce((total, diagnostic) => total + diagnostic.gapCount, 0),
        diagnostics, recommendations, qualityUpdatedAt: new Date().toISOString(),
      };
      const existing = nodes.find((node) => node.data.kind === 'diagnostics' && node.data.qualityProjectId === Number(projectId));
      const qualityNode = existing ?? newNode('diagnostics', { x: project.position.x + 390, y: project.position.y });
      qualityNode.data = { ...qualityNode.data, ...qualityData, qualityProjectId: Number(projectId), title: `${project.data.title} quality`, status: diagnostics.length ? 'Diagnostics current' : 'Not yet assessed', items: diagnostics };
      setNodes((current) => existing
        ? current.map((node) => node.id === project.id ? { ...node, data: { ...node.data, ...qualityData } } : node.id === existing.id ? { ...node, data: qualityNode.data } : node)
        : [...current.map((node) => node.id === project.id ? { ...node, data: { ...node.data, ...qualityData } } : node), qualityNode]);
      if (!existing) setEdges((current) => [...current, { id: crypto.randomUUID(), source: project.id, target: qualityNode.id, label: 'quality evidence', type: 'smoothstep', animated: true }]);
      setSelectedId(qualityNode.id);
      openNodeInspector(qualityNode.id);
      setNotice(diagnostics.length ? `${diagnostics.length} quality diagnostics added to the canvas` : t('noticeQualityCardAdded'));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'validated', projectId: Number(projectId), artifactId: project.id, durationMs: performance.now() - validationStartedAt, metricKey: 'validation_pass', metricValue: Number(quality.result.score ?? 0) >= 70 ? 1 : 0, unit: 'boolean', metadata: { score: quality.result.score, diagnosticCount: diagnostics.length } }).catch(() => undefined);
    }).catch((error) => {
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'failed', projectId: Number(projectId), artifactId: project.id, durationMs: performance.now() - validationStartedAt }).catch(() => undefined);
      setNotice(faultText(error, t('noticeLoadQualityFailed')));
    });
  }, [nodes, openNodeInspector, persistence, requireAccount, selectedNode, sessionId, setEdges, setNodes, setNotice, setSelectedId, t]);

  const deliverMockup = useCallback(() => {
    if (!selectedNode || (selectedNode.data.kind !== 'mockup' && selectedNode.data.kind !== 'mockupSet')) return;
    if (persistence === 'local') { requireAccount('deliver', 'Create an account to deliver this mockup', 'Delivery creates a durable project task, assigns an authorized Agent, and keeps execution status connected to this canvas.'); return; }
    const configuredProjectRef = typeof selectedNode.data.deliveryProjectRef === 'string' ? selectedNode.data.deliveryProjectRef : null;
    const configuredAgentRef = typeof selectedNode.data.mockupAgentRef === 'string' ? selectedNode.data.mockupAgentRef : null;
    const project = configuredProjectRef == null
      ? nodes.find((node) => node.data.kind === 'project')
      : nodes.find((node) => node.data.kind === 'project' && (node.data.resourceId || node.id) === configuredProjectRef);
    const agent = configuredAgentRef == null
      ? nodes.find((node) => node.data.kind === 'agent')
      : nodes.find((node) => node.data.kind === 'agent' && (node.data.resourceId || node.id) === configuredAgentRef);
    const projectId = (project ? canvasProjectId(project.data) : null) ?? NaN;
    const addTaskNode = (resourceId: string, status: string, detail: Partial<CreationNodeData> = {}) => {
      const taskId = crypto.randomUUID();
      const task: CreationFlowNode = {
        id: taskId, type: 'creation', position: { x: selectedNode.position.x + 330, y: selectedNode.position.y + 40 },
        data: { kind: 'task', title: `Build ${selectedNode.data.title}`, status, role: agent?.data.title || 'Available agent', assignee: agent?.data.title, agentRef: agent?.data.resourceId?.replace(/^agent:/, ''), priority: 'high', content: selectedNode.data.subtitle || 'Implement the approved canvas mockup.', subtitle: project ? `Deliver to ${project.data.title}.` : 'Attach a project when ready.', ...detail, resourceId },
      };
      setNodes((current) => { const base = current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status } } : node); return [...base, ...placeAppendedRef.current(base, [task])]; });
      setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: taskId, type: 'smoothstep', animated: true }]);
      setSelectedId(taskId);
      openNodeInspector(taskId);
      return taskId;
    };
    if (persistence === 'server' && Number.isInteger(projectId) && projectId > 0) {
      const deliveryCorrelationId = crypto.randomUUID();
      const deliveryStartedAt = performance.now();
      const deliverable: CreationDeliverable = { id: deliveryCorrelationId, action: 'deliver', artifactKind: 'project-task', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-tasks', resourceRef: `project:${projectId}` };
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivering…', deliverables: withCreationDeliverable(node.data, deliverable) } } : node));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'started', projectId, artifactId: selectedNode.id, metadata: { kind: selectedNode.data.kind } }).catch(() => undefined);
      setNotice(t('noticeCreatingDelivery'));
      const agentRef = agent?.data.resourceId?.startsWith('agent:') ? agent.data.resourceId.slice('agent:'.length) : undefined;
      void tasksApi.create({
        projectId,
        title: `Build ${selectedNode.data.title}`,
        description: `${selectedNode.data.subtitle || 'Implement the approved canvas mockup.'}\n\nSource creation session: ${sessionId}\nSource canvas object: ${selectedNode.id}`,
        priority: 'high',
        ...(agentRef ? { assignedAgentRef: agentRef } : {}),
      }).then(async (created) => {
        const delivered: CreationDeliverable = { ...deliverable, status: 'delivered', completedAt: new Date().toISOString(), resourceRef: `task:${created.id}`, validation: { status: 'passed', detail: `Task ${created.key || created.id} created in ${project?.data.title || `project ${projectId}`}` }, metadata: { projectId, taskId: created.id, agentRef: agentRef || null } };
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivered', deliverables: withCreationDeliverable(node.data, delivered) } } : node));
        const canvasTaskId = addTaskNode(`task:${created.id}`, created.status || (agentRef ? 'Assigned' : 'Ready'), { taskKey: created.key, priority: created.priority, content: created.description || undefined, agentRef: created.assignedAgentRef || undefined });
        trackActivity('creation_artifact_delivered', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds: [selectedNode.data.kind], projectId } });
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'succeeded', projectId, artifactId: selectedNode.id, durationMs: performance.now() - deliveryStartedAt, metricKey: 'delivered_outcomes', metricValue: 1, unit: 'count', metadata: { taskId: created.id, agentAssigned: !!agentRef } }).catch(() => undefined);
        if (agentRef) {
          trackActivity('creation_agent_assigned', { sessionId, metadata: { clientSurface: canvasSurface(), projectId } });
          let execution;
          try {
            execution = await runtimeApi.submitExecution({ taskId: created.id, sessionId });
          } catch (error) {
            setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status: 'Agent start failed' } } : node));
            setNotice(t('noticeDeliveryAgentFailed', { id: created.id, reason: error instanceof Error ? error.message : t('runtimeUnavailable') }));
            return;
          }
          if (isAwaitingApprovalExecution(execution)) {
            setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status: 'Awaiting approval' } } : node));
            setNotice(t('noticeDeliveryAwaitingApproval'));
          } else {
            setNotice(t('noticeDeliveryStarted'));
            const follow = async (remaining = 80) => {
              try {
                const live = await runtimeApi.get(execution.id);
                const status = String(live.status || 'running').replaceAll('_', ' ');
                setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status, executionId: execution.id, executionUpdatedAt: new Date().toISOString() } } : node));
                if (!['completed', 'failed', 'cancelled', 'canceled'].includes(String(live.status)) && remaining > 0) window.setTimeout(() => void follow(remaining - 1), 3_000);
                else setNotice(t('noticeAgentDelivery', { status }));
              } catch { if (remaining > 0) window.setTimeout(() => void follow(remaining - 1), 5_000); }
            };
            void follow();
          }
        } else {
          setNotice(t('noticeMockupDelivered'));
        }
      }).catch((error) => {
        const message = errorText(error);
        const failed: CreationDeliverable = { ...deliverable, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivery failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'failed', projectId, artifactId: selectedNode.id, durationMs: performance.now() - deliveryStartedAt }).catch(() => undefined);
        setNotice(message);
      });
      return;
    }
    addTaskNode(`draft-task:${crypto.randomUUID()}`, 'Draft');
    setNotice(t('noticeNeedProjectForDelivery'));
  }, [errorText, nodes, openNodeInspector, persistence, placeAppendedRef, requireAccount, selectedNode, sessionId, setEdges, setNodes, setNotice, setSelectedId, t]);

  const expandMockupSet = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'mockupSet') return;
    const labels = Array.isArray(selectedNode.data.items) && selectedNode.data.items.length
      ? selectedNode.data.items.map(String).slice(0, 10)
      : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration'];
    const additions = labels.map((label, index): CreationFlowNode => ({ id: crypto.randomUUID(), type: 'creation', position: { x: selectedNode.position.x + 440 + (index % 2) * 330, y: selectedNode.position.y - 180 + Math.floor(index / 2) * 220 }, data: { kind: 'mockup', title: label, status: 'Ready for review', subtitle: `High-fidelity concept ${index + 1} of ${labels.length}.` } }));
    setNodes((current) => [...current, ...placeAppendedRef.current(current, additions)]);
    setEdges((current) => [...current, ...additions.map((node) => ({ id: crypto.randomUUID(), source: selectedNode.id, target: node.id, type: 'smoothstep', label: 'contains', animated: true }))]);
    setNotice(t('noticeMockupsExpanded', { count: additions.length }));
  }, [placeAppendedRef, selectedNode, setEdges, setNodes, setNotice, t]);
  return { expandProject, compareProjects, expandMockupSet, deliverMockup, loadProjectQuality };
}
