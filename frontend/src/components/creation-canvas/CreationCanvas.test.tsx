import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { associateBrainWithArtifacts, CreationCanvas, persistCanonicalProjectPrd, shouldAcquireCanvasObjectLock } from './CreationCanvas';
import { CreationNode } from './CreationNode';
import { specsApi } from '@/lib/builderforceApi';
import type { CreationFlowNode } from './CreationNode';

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

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  const inert = () => null;
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    ReactFlow: ({ nodes, edges = [], nodeTypes, onNodeClick }: { nodes: Array<{ id: string; type?: string; data: unknown; style?: { width?: number; height?: number } }>; edges?: Array<{ source: string; target: string }>; nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>; onNodeClick?: (event: unknown, node: unknown) => void }) => React.createElement('div', { 'data-testid': 'flow', 'data-edge-pairs': edges.map((edge) => `${edge.source}:${edge.target}`).join(',') }, nodes.map((node) => {
      const Component = nodeTypes[node.type || 'creation'];
      return Component ? React.createElement('div', { key: node.id, onClick: (event: React.MouseEvent<HTMLDivElement>) => onNodeClick?.(event, node) }, React.createElement(Component, { id: node.id, data: node.data, selected: false, width: node.style?.width, height: node.style?.height })) : null;
    })),
    useNodesState: (initial: unknown[]) => { const [nodes, setNodes] = React.useState(initial); return [nodes, setNodes, inert] as const; },
    useEdgesState: (initial: unknown[]) => { const [edges, setEdges] = React.useState(initial); return [edges, setEdges, inert] as const; },
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: inert, Controls: inert, MiniMap: inert, Handle: inert, NodeResizer: inert,
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
  beforeEach(() => {
    localStorage.clear();
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
    const microphone = screen.getByRole('button', { name: 'Use microphone' });
    expect(microphone.querySelector('svg')).toBeInTheDocument();
    const autoApply = screen.getByRole('button', { name: 'Auto apply' });
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

  it('makes Add useful when the object palette is already open', async () => {
    render(<CreationCanvas sessionId="palette-add-test" persistence="local" />);

    const add = screen.getByRole('button', { name: '＋ Add' });
    expect(add).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(add);

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search everything…' })).toHaveFocus());
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
    expect(screen.getByText('Build the future together')).toBeInTheDocument();
    expect(screen.getByText('Start building')).toBeInTheDocument();
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
    expect(screen.getByText(/blueprint works without an account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add creation & training pipeline' }));

    expect(screen.getByText('Evermind creation and training pipeline added')).toBeInTheDocument();
    expect(screen.getByText('Tokenizer build')).toBeInTheDocument();
    expect(screen.getByText('Evermind tuning run')).toBeInTheDocument();
    expect(screen.getByText('Model quality gate')).toBeInTheDocument();
    expect(screen.getByText('Training telemetry')).toBeInTheDocument();
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
