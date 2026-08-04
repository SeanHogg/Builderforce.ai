import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { associateBrainWithArtifacts, canvasChangesCanAutoApply, CreationCanvas, persistCanonicalProjectPrd, projectEvermindNodePatch, shouldAcquireCanvasObjectLock, type ProposedCanvasChange } from './CreationCanvas';
import { CreationNode } from './CreationNode';
import { specsApi } from '@/lib/builderforceApi';
import type { CreationFlowNode } from './CreationNode';
import type { ProjectEvermindContributions, ProjectEvermindHead } from '@/lib/projectEvermindApi';

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const messages = (await import('@/i18n/messages/en.json')).default as Record<string, unknown>;
  return {
    ...actual,
    useTranslations: (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
      const path = (namespace ? `${namespace}.${key}` : key).split('.');
      const value = path.reduce<unknown>((current, segment) => current && typeof current === 'object'
        ? (current as Record<string, unknown>)[segment]
        : undefined, messages);
      const copy = typeof value === 'string' ? value : namespace ? `${namespace}.${key}` : key;
      return Object.entries(values ?? {}).reduce((result, [name, replacement]) => result.replace(`{${name}}`, String(replacement)), copy);
    },
  };
});

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  const inert = () => null;
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    ReactFlow: ({ nodes, edges = [], nodeTypes, onNodeClick, children }: { nodes: Array<{ id: string; type?: string; data: unknown; style?: { width?: number; height?: number } }>; edges?: Array<{ source: string; target: string }>; nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>; onNodeClick?: (event: unknown, node: unknown) => void; children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'flow', 'data-edge-pairs': edges.map((edge) => `${edge.source}:${edge.target}`).join(',') }, children, nodes.map((node) => {
      const Component = nodeTypes[node.type || 'creation'];
      return Component ? React.createElement('div', { key: node.id, onClick: (event: React.MouseEvent<HTMLDivElement>) => onNodeClick?.(event, node) }, React.createElement(Component, { id: node.id, data: node.data, selected: false, width: node.style?.width, height: node.style?.height })) : null;
    })),
    useNodesState: (initial: unknown[]) => { const [nodes, setNodes] = React.useState(initial); return [nodes, setNodes, inert] as const; },
    useEdgesState: (initial: unknown[]) => { const [edges, setEdges] = React.useState(initial); return [edges, setEdges, inert] as const; },
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: inert,
    Controls: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    ControlButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
    MiniMap: inert, Handle: inert, NodeResizer: inert,
    BackgroundVariant: { Dots: 'dots' }, MarkerType: { ArrowClosed: 'arrowclosed' }, Position: { Left: 'left', Right: 'right' },
  };
});

vi.mock('@/components/workflow-builder/WorkflowBuilder', () => ({
  WorkflowBuilder: ({ onSaved, onRunStarted }: { onSaved?: (id: string, name: string) => void; onRunStarted?: (id: number) => void }) => <div>
    <button type="button" onClick={() => onSaved?.('workflow-updated', 'Updated campaign workflow')}>Save embedded workflow</button>
    <button type="button" onClick={() => onRunStarted?.(91)}>Run embedded workflow</button>
  </div>,
}));

describe('CreationCanvas', { timeout: 15_000 }, () => {
  it('opens the mini map by default and lets it be closed and reopened from the canvas controls', () => {
    render(<CreationCanvas sessionId="minimap-controls-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Close mini map' }));
    expect(screen.getByRole('button', { name: 'Open mini map' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open mini map' }));
    expect(screen.getByRole('button', { name: 'Close mini map' })).toBeInTheDocument();
  });

  it('auto-applies basic canvas output but keeps consequential changes in review', () => {
    const visual = {
      id: 'add-visual', type: 'object.add', label: 'Add astronomy visual',
      node: { id: 'visual', type: 'creation', position: { x: 100, y: 100 }, data: { kind: 'mockup', title: 'Astronomy visual' } },
    } satisfies ProposedCanvasChange;
    const response = {
      id: 'update-response', type: 'object.update', label: 'Update Brain response',
      objectId: 'brain', patch: { aiResponse: 'A foundational explanation.' },
    } satisfies ProposedCanvasChange;

    expect(canvasChangesCanAutoApply([visual, response])).toBe(true);
    expect(canvasChangesCanAutoApply([{ id: 'delete', type: 'object.delete', label: 'Delete', objectId: 'visual' }])).toBe(false);
    expect(canvasChangesCanAutoApply([{
      ...visual, id: 'canonical-prd', node: { ...visual.node, data: { ...visual.node.data, kind: 'prd', canonicalPrdPending: true } },
    }])).toBe(false);
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('groups canvas history controls without changing their accessible actions', () => {
    render(<CreationCanvas sessionId="history-controls-test" persistence="local" />);
    const group = screen.getByRole('group', { name: 'Canvas history' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Undo canvas change' }));
    expect(group).toContainElement(screen.getByRole('button', { name: 'Redo canvas change' }));
  });

  it('does not lock a newly created server object until autosave persists it', () => {
    const objectId = 'a5d80af7-bb65-45cc-bd2b-d190616fc904';
    expect(shouldAcquireCanvasObjectLock('server', objectId, true, new Set())).toBe(false);
    expect(shouldAcquireCanvasObjectLock('server', objectId, true, new Set([objectId]))).toBe(true);
  });

  it('persists an accepted PRD to its canonical project before materializing its canvas reference', async () => {
    const createSpec = vi.fn(async (body: Parameters<typeof specsApi.create>[0]) => ({
      id: '6f4b36f8-f8a0-49e8-aeed-faa42cacad11', projectId: body.projectId ?? null,
      goal: body.goal, prd: body.prd ?? null, status: body.status ?? 'draft', kind: body.kind,
    })) as typeof specsApi.create;
    const node = {
      id: 'prd-node', type: 'creation', position: { x: 500, y: 200 },
      data: { kind: 'prd', title: 'BuilderForce consolidated PRD', status: 'ready', markdown: '# Complete requirements', sourceProjectId: 42, canonicalPrdPending: true },
    } satisfies CreationFlowNode;

    const saved = await persistCanonicalProjectPrd(node, createSpec);

    expect(createSpec).toHaveBeenCalledWith({ projectId: 42, goal: 'BuilderForce consolidated PRD', prd: '# Complete requirements', status: 'ready', kind: 'feature' });
    expect(saved.data.resourceId).toBe('spec:6f4b36f8-f8a0-49e8-aeed-faa42cacad11');
    expect(saved.data.canonicalPrdPending).toBeUndefined();
  });

  it('associates Brain with artifacts once without duplicating relationships', () => {
    const once = associateBrainWithArtifacts([], 'brain', ['artifact']);
    const twice = associateBrainWithArtifacts(once, 'brain', ['artifact']);
    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ source: 'brain', target: 'artifact', label: 'Brain context', data: { connectionKind: 'reference' } });
  });

  it('fills the persisted project boundary with the visible project card', () => {
    render(<CreationNode
      id="project-node"
      type="creation"
      data={{ kind: 'project', title: 'BuilderForce.AI' }}
      selected
      width={320}
      height={220}
      dragging={false}
      zIndex={0}
      selectable
      deletable
      draggable
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />);

    expect(screen.getByRole('article')).toHaveStyle({ width: '320px', height: '220px' });
  });

  it('updates the project widget rendering when its project view changes', () => {
    const props = {
      id: 'project-node', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
      selectable: true, deletable: true, draggable: true, isConnectable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    };
    const { rerender } = render(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', status: 'active' }} />);
    expect(screen.getByText('Project context')).toBeInTheDocument();

    rerender(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', projectLens: 'delivery', open: 12, blocked: 2 }} />);
    expect(screen.getByText('Open work')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();

    rerender(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', projectLens: 'metrics', velocity: 48 }} />);
    expect(screen.getByText('Maturity')).toBeInTheDocument();
    expect(screen.getByText('48 pts')).toBeInTheDocument();

    rerender(<CreationNode {...props} data={{ kind: 'project', title: 'BuilderForce.AI', projectLens: 'customer-feedback', feedback: ['Faster onboarding'] }} />);
    expect(screen.getByText('Customer feedback')).toBeInTheDocument();
    expect(screen.getByText('Faster onboarding')).toBeInTheDocument();
  });

  it('visualizes single-project quality diagnostics and recommendations', () => {
    render(<CreationNode
      id="quality-node" type="creation" selected={false} dragging={false} zIndex={0}
      selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
      data={{
        kind: 'diagnostics', title: 'BuilderForce.AI quality', qualityScore: 72, qualityLabel: 'Needs attention',
        qualityHeadline: 'Two checks found release risk', diagnosticCount: 2, gapCount: 3,
        diagnostics: [
          { toolId: 'code-quality', name: 'Code quality', icon: '◆', score: 84, scoreLabel: 'Healthy', headline: 'Core checks pass', gapCount: 1, recommendations: [{ title: 'Raise branch coverage', detail: 'Cover the error paths.' }] },
          { toolId: 'delivery', name: 'Delivery readiness', icon: '△', score: 60, scoreLabel: 'At risk', headline: 'CI is unstable', gapCount: 2, recommendations: [{ title: 'Fix failing CI', detail: 'Resolve the release-blocking tests.' }] },
        ],
        recommendations: [{ title: 'Fix failing CI', detail: 'Resolve the release-blocking tests.', diagnostic: 'Delivery readiness' }],
      }}
    />);

    expect(screen.getByRole('region', { name: 'Project quality' })).toHaveTextContent('72/100');
    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Delivery readiness');
    expect(screen.getByRole('region', { name: 'Diagnostic next steps' })).toHaveTextContent('Fix failing CI');
  });

  it('compares quality across projects and prioritizes recommendations', () => {
    render(<CreationNode
      id="comparison-node" type="creation" selected={false} dragging={false} zIndex={0}
      selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0}
      data={{ kind: 'projectComparison', title: 'Portfolio quality', fetchedAt: '2026-08-02T12:00:00.000Z', projects: [
        { name: 'Alpha', status: 'active', qualityScore: 88, qualityLabel: 'Healthy', diagnosticCount: 2, gapCount: 1, progress: 70, open: 4, blocked: 0, diagnostics: [{ toolId: 'quality', name: 'Code quality', score: 88, gapCount: 1 }], recommendations: [{ title: 'Add edge-case tests', detail: 'Close the remaining gap.', diagnostic: 'Code quality', score: 88 }] },
        { name: 'Beta', status: 'active', qualityScore: 52, qualityLabel: 'At risk', diagnosticCount: 2, gapCount: 4, progress: 30, open: 9, blocked: 3, diagnostics: [{ toolId: 'delivery', name: 'Delivery readiness', score: 52, gapCount: 4 }], recommendations: [{ title: 'Stabilize CI first', detail: 'The build blocks delivery.', diagnostic: 'Delivery readiness', score: 52 }] },
      ] }}
    />);

    expect(screen.getByRole('region', { name: 'Portfolio quality summary' })).toHaveTextContent('70/100');
    expect(screen.getByRole('region', { name: 'Prioritized recommendations' })).toHaveTextContent('Stabilize CI first');
    expect(screen.getByText('Lowest-scoring evidence first')).toBeInTheDocument();
  });

  it('visualizes every diagnostic with its result and next steps', () => {
    render(<CreationNode
      id="diagnostics-node"
      type="creation"
      data={{
        kind: 'diagnostics', title: 'Build diagnostics', summary: 'Build completed with issues',
        diagnostics: [
          { id: 'ts-1', severity: 'error', message: 'Type mismatch', detail: 'Expected string but received number', path: 'src/app.ts', line: 42, result: 'Failed', recommendation: 'Correct the value type.' },
          { id: 'lint-1', severity: 'warning', message: 'Unused import', result: 'Warning' },
          { id: 'test-1', severity: 'passed', message: 'Unit tests', result: 'Passed' },
        ],
        results: ['18 checks ran', '1 check failed'],
        nextSteps: ['Fix the failing type check', 'Run the suite again'],
      }}
      selected={false}
      dragging={false}
      zIndex={0}
      selectable
      deletable
      draggable
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />);

    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Type mismatch');
    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Unused import');
    expect(screen.getByRole('region', { name: 'Diagnostics findings' })).toHaveTextContent('Unit tests');
    expect(screen.getByRole('region', { name: 'Diagnostic results' })).toHaveTextContent('Build completed with issues');
    expect(screen.getByRole('region', { name: 'Diagnostic results' })).toHaveTextContent('18 checks ran');
    expect(screen.getByRole('region', { name: 'Diagnostic next steps' })).toHaveTextContent('Fix the failing type check');
    expect(screen.getByRole('region', { name: 'Diagnostic next steps' })).toHaveTextContent('Correct the value type.');
  });

  it('applies the inspector project view selection to the canvas widget', () => {
    render(<CreationCanvas sessionId="project-view-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));

    const projectView = screen.getByLabelText('Project view');
    fireEvent.change(projectView, { target: { value: 'metrics' } });
    expect(screen.getByText('Maturity')).toBeInTheDocument();

    fireEvent.change(projectView, { target: { value: 'delivery' } });
    expect(screen.getByText('Open work')).toBeInTheDocument();
    expect(screen.queryByText('Maturity')).not.toBeInTheDocument();
  });

  it('expands, restores, and keyboard-resizes the details panel', () => {
    render(<CreationCanvas sessionId="inspector-resize-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));

    const inspector = screen.getByRole('complementary', { name: 'Details panel' });
    const resizeHandle = screen.getByRole('separator', { name: 'Resize details panel' });
    expect(inspector).toHaveStyle({ '--inspector-width': '270px' });

    fireEvent.click(screen.getByRole('button', { name: 'Expand details panel' }));
    expect(inspector).toHaveStyle({ '--inspector-width': '520px' });
    expect(localStorage.getItem('builderforce:create:inspector-width')).toBe('520');

    fireEvent.click(screen.getByRole('button', { name: 'Restore details panel width' }));
    expect(inspector).toHaveStyle({ '--inspector-width': '270px' });

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });
    expect(inspector).toHaveStyle({ '--inspector-width': '290px' });
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '290');
  });

  it('renders agent model, instructions, tools, and autonomy changes live', () => {
    render(<CreationCanvas sessionId="agent-settings-test" persistence="local" />);
    fireEvent.click(screen.getAllByText('Campaign Strategist')[0]!);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Evermind' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Investigate customer friction.' } });
    fireEvent.change(screen.getByLabelText('Autonomy'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add tool' }));

    expect(screen.getAllByText('Evermind').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Investigate customer friction.').length).toBeGreaterThan(1);
    expect(screen.getByText('High autonomy')).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('renders workflow target and approval changes live', () => {
    render(<CreationCanvas sessionId="workflow-settings-test" persistence="local" />);
    fireEvent.click(screen.getByText('Fall campaign workflow'));

    fireEvent.change(screen.getByLabelText('Execution target'), { target: { value: 'campaign-strategist' } });
    fireEvent.change(screen.getByLabelText('Approval mode'), { target: { value: 'autonomous' } });

    expect(screen.getAllByText('Campaign Strategist').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Fully autonomous').length).toBeGreaterThan(1);
  });

  it('renders dashboard range and refresh changes live', () => {
    render(<CreationCanvas sessionId="dashboard-settings-test" persistence="local" />);
    fireEvent.click(screen.getByText('Campaign forecast'));

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'qtd' } });
    expect(screen.getAllByText('Quarter to date').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live data' }));
    expect(screen.getByText('Refreshed')).toBeInTheDocument();
  });

  it('renders mockup delivery selections and uses explicit unassignment', () => {
    render(<CreationCanvas sessionId="mockup-settings-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mockup' }));

    fireEvent.change(screen.getByLabelText('Delivery project'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Assign agent'), { target: { value: 'web-analyst' } });

    expect(screen.getByText('Project: No project')).toBeInTheDocument();
    expect(screen.getByText('Agent: Web Analyst')).toBeInTheDocument();
  });

  it('shows task ownership, priority, PRD context, and completion criteria on the widget', () => {
    render(<CreationNode
      id="task-node" type="creation" selected={false} dragging={false} zIndex={0} selectable deletable draggable isConnectable
      positionAbsoluteX={0} positionAbsoluteY={0}
      data={{ kind: 'task', title: 'Ship task details', status: 'in_progress', assignee: 'Delivery Agent', priority: 'high', content: 'Close the information gaps.', prdTitle: 'Task widget parity', prdSummary: 'Show the context an agent needs.', acceptanceCriteria: 'Owner, state, and requirements are visible.' }}
    />);

    expect(screen.getByText('Delivery Agent')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Task widget parity')).toBeInTheDocument();
    expect(screen.getByText('Owner, state, and requirements are visible.')).toBeInTheDocument();
  });

  it('renders staff and task inspector edits live on their widgets', () => {
    render(<CreationCanvas sessionId="people-work-settings-test" persistence="local" />);
    fireEvent.click(screen.getByText('Sarah'));
    fireEvent.change(screen.getByDisplayValue('Marketing'), { target: { value: 'Product lead' } });
    fireEvent.change(screen.getByLabelText('Current focus'), { target: { value: 'Validate the launch scope.' } });
    expect(screen.getByText('Product lead')).toBeInTheDocument();
    expect(screen.getAllByText('Validate the launch scope.').length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Task' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'blocked' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'urgent' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Resolve the release dependency.' } });
    fireEvent.change(screen.getByLabelText('Acceptance criteria'), { target: { value: 'Dependency is closed.' } });
    expect(screen.getByText('urgent')).toBeInTheDocument();
    expect(screen.getAllByText('Resolve the release dependency.').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Dependency is closed.').length).toBeGreaterThan(1);
  });

  it('gives task widgets actionable status, agent, and PRD details', () => {
    render(<CreationCanvas sessionId="task-details-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Task' }));

    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Assigned agent')).toHaveDisplayValue(/Campaign Strategist/);
    expect(screen.getByText('How to move this forward')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Task PRD' })).toHaveTextContent('No PRD linked');
  });

  it('renders live workflow, website, dashboard, collaborators, and agent controls', () => {
    render(<CreationCanvas sessionId="campaign-test" persistence="local" />);

    expect(screen.getByText('Fall campaign workflow')).toBeInTheDocument();
    expect(screen.getAllByText('Campaign landing page').length).toBeGreaterThan(0);
    expect(screen.getByText('Campaign forecast')).toBeInTheDocument();
    expect(screen.getByLabelText('Active collaborators')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask Brain about this canvas')).toHaveValue('');
    fireEvent.click(screen.getAllByText('Campaign Strategist')[0]!);
    expect(screen.getByDisplayValue('Campaign Strategist')).toBeInTheDocument();
  });

  it('renders a scrollable Brain transcript, rich chat details, and a recognizable microphone control', () => {
    render(<CreationCanvas sessionId="brain-object-details-test" persistence="local" />);

    expect(screen.getByRole('log', { name: 'Brain chat history' })).toHaveAttribute('tabindex', '0');
    const microphone = screen.getByRole('button', { name: 'Dictate' });
    expect(microphone.querySelector('svg')).toBeInTheDocument();
    const autoApply = screen.getByRole('button', { name: 'Auto mode' });
    expect(autoApply).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(autoApply);
    expect(autoApply).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('brain.autoApprove')).toBe('1');

    fireEvent.click(screen.getAllByText('Brain')[0]!);
    expect(screen.getByRole('log', { name: 'Full Brain activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Associated tickets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connected objects' })).toBeInTheDocument();
  });

  it('opens the Brain chat as soon as a footer prompt is submitted', () => {
    render(<CreationCanvas sessionId="composer-opens-brain-test" persistence="local" />);

    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Show which agents are active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));

    expect(screen.getByRole('log', { name: 'Full Brain activity' })).toBeInTheDocument();
    expect(screen.getAllByText('Show which agents are active').length).toBeGreaterThan(0);
  });

  it('runs workflows from the workflow widget instead of the session header', () => {
    render(<CreationCanvas sessionId="workflow-widget-run-test" persistence="local" />);

    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run Fall campaign workflow' }));

    expect(screen.getByText('Draft workflow running locally…')).toBeInTheDocument();
  });

  it('gates durable guest actions with account creation while preserving local creation', () => {
    render(<CreationCanvas sessionId="account-gate-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Save & collaborate' }));
    expect(screen.getByRole('dialog', { name: 'Create an account to save and collaborate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create free account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now — keep creating locally' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ask Brain about this canvas')).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    expect(screen.getByRole('dialog', { name: 'Create an account to share this canvas' })).toBeInTheDocument();
  });

  it('closes the invitation panel from its dedicated close control', () => {
    render(<CreationCanvas sessionId="close-invitation-panel-test" persistence="local" initialShareOpen />);

    expect(screen.getByRole('dialog', { name: 'Save to invite people' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close invitation panel' }));

    expect(screen.queryByRole('dialog', { name: 'Save to invite people' })).not.toBeInTheDocument();
  });

  it('edits and runs a canonical workflow in an isolated Canvas focus editor', () => {
    render(<CreationCanvas sessionId="workflow-focus-test" persistence="local" />);
    fireEvent.click(screen.getByText('Fall campaign workflow'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Workflow on Canvas' }));

    expect(screen.getByRole('dialog', { name: 'Workflow focus editor' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save embedded workflow' }));
    expect(screen.getByDisplayValue('Updated campaign workflow')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run embedded workflow' }));
    expect(screen.getByText('Workflow run 91 started')).toBeInTheDocument();
  });

  it('adds a selected object from the palette', () => {
    render(<CreationCanvas sessionId="palette-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Dataset' }));

    expect(screen.getByDisplayValue('Imported dataset.csv')).toBeInTheDocument();
  });

  it('uses the open object palette without duplicating Add in the header', () => {
    render(<CreationCanvas sessionId="palette-add-test" persistence="local" />);

    expect(screen.getByText('Add to canvas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Add' })).not.toBeInTheDocument();
  });

  it('collapses palette sections, reveals search matches, and retains the state', async () => {
    const first = render(<CreationCanvas sessionId="palette-collapse-test" persistence="local" />);
    const build = screen.getByRole('button', { name: /Build/ });
    fireEvent.click(build);
    expect(build).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Workflow' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search everything…' }), { target: { value: 'Workflow' } });
    expect(screen.getByRole('button', { name: 'Workflow' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByRole('button', { name: 'Workflow' })).not.toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('builderforce:create:palette-collapsed-groups')).toContain('Build'));

    first.unmount();
    render(<CreationCanvas sessionId="palette-collapse-reopen-test" persistence="local" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Build/ })).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('button', { name: 'Workflow' })).not.toBeInTheDocument();
  });

  it('turns an AI request into a connected evaluation object', async () => {
    render(<CreationCanvas sessionId="evaluation-test" persistence="local" />);

    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Evaluate the selected canvas objects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));
    await waitFor(() => expect(screen.getByDisplayValue('Canvas evaluation')).toBeInTheDocument(), { timeout: 2_000 });
    expect(screen.getByText('Evaluation added to canvas')).toBeInTheDocument();
  });

  it('expands optional project context into related live objects', () => {
    render(<CreationCanvas sessionId="project-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add all related items' }));

    expect(screen.getByText('Project relationships added to canvas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BuilderForce launch')).toBeInTheDocument();
  });

  it('creates feature mockups and dispatches their delivery from the session', async () => {
    render(<CreationCanvas sessionId="feature-test" persistence="local" />);
    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Create a visual summary of the top 10 requested features and mockups' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));
    await waitFor(() => expect(screen.getByDisplayValue('Top 10 feature mockups')).toBeInTheDocument(), { timeout: 2_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Add to project and assign' }));
    expect(screen.getByRole('dialog', { name: 'Create an account to deliver this mockup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create free account' })).toBeInTheDocument();
  });

  it('edits a website prototype live from the inspector', () => {
    render(<CreationCanvas sessionId="website-editor-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Build the future together' } });
    fireEvent.change(screen.getByLabelText('Call to action'), { target: { value: 'Start building' } });
    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#d946ef' } });
    expect(screen.getByText('Build the future together')).toBeInTheDocument();
    expect(screen.getByText('Start building')).toHaveStyle({ background: '#d946ef' });
  });

  it('resizes website viewport presets and renders supporting copy as Markdown', () => {
    render(<CreationCanvas sessionId="website-responsive-test" persistence="local" />);
    fireEvent.click(screen.getAllByText('Campaign landing page')[0]!);
    fireEvent.change(screen.getByLabelText('Supporting copy'), { target: { value: '**Secure banking** with transparent pricing.' } });
    expect(screen.getByText('Secure banking').tagName).toBe('STRONG');
    fireEvent.change(screen.getByLabelText('Viewport'), { target: { value: 'mobile' } });
    expect(screen.getByLabelText('Viewport')).toHaveValue('mobile');
    const previewNode = document.querySelector('article[data-viewport="mobile"]');
    expect(previewNode).toHaveStyle({ width: '340px', height: '620px' });
  });

  it('imports tabular data and creates a connected visualization', async () => {
    render(<CreationCanvas sessionId="dataset-visual-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dataset' }));
    const file = new File(['Region,Revenue\nNorth,120\nSouth,90'], 'revenue.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('Region,Revenue\nNorth,120\nSouth,90') });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import CSV or TSV'), { target: { files: [file] } });
      await Promise.resolve();
    });
    expect(screen.getByText('2 rows · 2 columns')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create visualization' }));
    expect(screen.getByDisplayValue('revenue.csv visualization')).toBeInTheDocument();
    expect(screen.getAllByText('North').length).toBeGreaterThan(0);
  });

  it('designs Evermind creation and training as a canvas-native pipeline', () => {
    render(<CreationCanvas sessionId="evermind-pipeline-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Evermind' }));

    expect(screen.getByDisplayValue('Untitled Evermind')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Knowledge map with 0 learned contributions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recently learned' })).toHaveTextContent('Nothing learned yet');
    expect(screen.getByText('Hippocampus')).toBeInTheDocument();
    expect(screen.getByText(/blueprint works without an account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start guided setup' }));

    expect(screen.getByText(/Step 1 of 5.*choose a CSV or TSV/i)).toBeInTheDocument();
    expect(screen.getByText('Tokenize examples')).toBeInTheDocument();
    expect(screen.getByText('Distil & tune')).toBeInTheDocument();
    expect(screen.getByText('Quality gate')).toBeInTheDocument();
    expect(screen.getByText('Learning telemetry')).toBeInTheDocument();
  });

  it('projects canonical active-project Evermind state onto a persisted canvas node', () => {
    const head: ProjectEvermindHead = { version: 9722, ref: 'evermind/project/30/v9722', mode: 'connected', name: 'Project Evermind', contributions: 17_112, inferenceEnabled: false, teacherModel: null, lastLearnedAt: '2026-08-03T02:33:51.127Z', seeded: true, quarantinedAt: '2026-07-26T16:10:30.453Z', quarantineReason: 'coherence probe failed' };
    const activity = {
      version: 9722, seeded: true, mode: 'connected', contributions: 17_112, inferenceEnabled: false, teacherModel: null,
      lastLearnedAt: head.lastLearnedAt, pending: 0, recent: [{ id: 1, kind: 'text' as const, version: 9722, at: Date.now(), weight: 0.4, prompt: 'Active project task', text: 'Learned result', skipReason: 'not_pinned' }],
      training: [{ version: 9722, at: Date.now(), loss: 3.2246, seqs: 10, moved: 42, deltaNorm: .2, merged: 1 }],
      eval: { version: 9722, at: Date.now(), baseLoss: 3.3164, newLoss: 3.2246, delta: .0918, evalSize: 6 },
      affect: { state: { valence: 0, arousal: 0, driveCuriosity: 0, driveCaution: 0, driveEffort: 0, driveSocial: 0, attention: 0, exploration: 0 }, setpoints: { valence: 0, arousal: 0, driveCuriosity: 0, driveCaution: 0, driveEffort: 0, driveSocial: 0, attention: 0, exploration: 0 }, attentionGain: 0, exploreBias: 0 },
      quarantinedAt: head.quarantinedAt, quarantineReason: head.quarantineReason,
    } satisfies ProjectEvermindContributions;

    const patch = projectEvermindNodePatch(head, activity);
    expect(patch).toMatchObject({ evermindVersion: 9722, contributions: 17_112, learningMode: 'connected', inferenceEnabled: false, trainingLoss: 3.2246, quarantinedAt: head.quarantinedAt });
    render(<CreationNode id="live-evermind" type="creation" data={{ kind: 'evermind', title: 'EverMind', ...patch }} selected={false} dragging={false} zIndex={0} selectable deletable draggable isConnectable positionAbsoluteX={0} positionAbsoluteY={0} />);
    expect(screen.getAllByText('v9722').length).toBeGreaterThan(0);
    expect(screen.getByText('17112')).toBeInTheDocument();
    expect(screen.getAllByText('Active project task').length).toBeGreaterThan(0);
    expect(screen.getByText('Quarantined — run readiness first')).toBeInTheDocument();
  });

  it('keeps anonymous object comments unblocked as a save-later collaboration step', () => {
    render(<CreationCanvas sessionId="local-comment-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    expect(screen.getByText('Collaboration starts when you save')).toBeInTheDocument();
    expect(screen.getByText(/Sign in to add comments, mentions, shared activity/i)).toBeInTheDocument();
  });

  it('requires two canonical projects before creating a live comparison', () => {
    render(<CreationCanvas sessionId="comparison-gate-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare projects on canvas' }));

    expect(screen.getByRole('dialog', { name: 'Create an account to compare projects' })).toBeInTheDocument();
  });

  it('gathers staff and agents into an impromptu stand-up frame', () => {
    render(<CreationCanvas sessionId="standup-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Stand-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gather and start stand-up' }));

    expect(screen.getByRole('dialog', { name: 'Create an account to start a collaborative stand-up' })).toBeInTheDocument();
    expect(screen.getAllByText('Sarah').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Campaign Strategist').length).toBeGreaterThan(0);
  });

  it('adds a reusable Marketplace object pack to the session', () => {
    render(<CreationCanvas sessionId="template-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: /Product discovery/i }));

    expect(screen.getByText('Product discovery added from Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Customer feedback')).toBeInTheDocument();
    expect(screen.getByText('Opportunity evaluation')).toBeInTheDocument();
  });

  it('customizes and saves a reusable spatial frame', () => {
    render(<CreationCanvas sessionId="frame-preset-test" persistence="local" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Frame' }).find((button) => button.getAttribute('draggable') === 'true')!);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Decision review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as reusable frame' }));
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));

    expect(screen.getByText('Reusable frame saved to your template library')).toBeInTheDocument();
    expect(screen.getByText('Your reusable frames')).toBeInTheDocument();
    expect(screen.getByText('Private custom frame')).toBeInTheDocument();
  });

  it('renders frame colors and drawing stroke settings live', () => {
    render(<CreationCanvas sessionId="spatial-settings-test" persistence="local" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Frame' }).find((button) => button.getAttribute('draggable') === 'true')!);
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Architecture review' } });
    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#123456' } });
    fireEvent.change(screen.getByLabelText('Border color'), { target: { value: '#abcdef' } });
    const purpose = screen.getByText('Architecture review');
    expect(purpose.closest('article')).toHaveStyle({ background: '#123456', borderColor: '#abcdef' });

    fireEvent.click(screen.getByRole('button', { name: 'Drawing' }));
    fireEvent.change(screen.getByLabelText('Stroke color'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Stroke width'), { target: { value: '9' } });
    expect(screen.getByText('9 px')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sketch' })).toHaveStyle({ color: '#ff0000' });
  });

  it('keeps the session header focused and moves object commands into contextual controls', () => {
    render(<CreationCanvas sessionId="header-test" persistence="local" />);

    expect(screen.getByRole('button', { name: 'More session actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Templates' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Fall campaign workflow'));
    expect(screen.getByLabelText('Selection actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
  });

  it('exposes one-paste Canvas and Session chat diagnostics', () => {
    render(<CreationCanvas sessionId="diagnostics-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas diagnostics' }));
    expect(screen.getByLabelText('Canvas diagnostics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Canvas diagnostics' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
    expect(screen.getByRole('button', { name: 'Copy Session chat diagnostics' })).toBeInTheDocument();
  });

  it('provides a keyboard-readable structured graph and semantic connections', () => {
    render(<CreationCanvas sessionId="accessible-graph-test" persistence="local" />);

    fireEvent.click(screen.getByText('Accessible canvas outline'));
    expect(screen.getByRole('button', { name: 'Focus Fall campaign workflow' })).toBeInTheDocument();
    expect(screen.getByText(/control connection to Campaign landing page: publishes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Focus Campaign landing page' }));
    expect(screen.getByDisplayValue('Campaign landing page')).toBeInTheDocument();
  });
});
