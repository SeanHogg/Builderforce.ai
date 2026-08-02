import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationCanvas } from './CreationCanvas';

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
    ReactFlow: ({ nodes, nodeTypes, onNodeClick }: { nodes: Array<{ id: string; type?: string; data: unknown }>; nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>; onNodeClick?: (event: unknown, node: unknown) => void }) => React.createElement('div', { 'data-testid': 'flow' }, nodes.map((node) => {
      const Component = nodeTypes[node.type || 'creation'];
      return Component ? React.createElement('div', { key: node.id, onClick: (event: React.MouseEvent<HTMLDivElement>) => onNodeClick?.(event, node) }, React.createElement(Component, { id: node.id, data: node.data, selected: false })) : null;
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

  it('renders live workflow, website, dashboard, collaborators, and agent controls', () => {
    render(<CreationCanvas sessionId="campaign-test" persistence="local" />);

    expect(screen.getByText('Fall campaign workflow')).toBeInTheDocument();
    expect(screen.getAllByText('Campaign landing page').length).toBeGreaterThan(0);
    expect(screen.getByText('Campaign forecast')).toBeInTheDocument();
    expect(screen.getByLabelText('Active collaborators')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Campaign Strategist')[0]!);
    expect(screen.getByDisplayValue('Campaign Strategist')).toBeInTheDocument();
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

  it('turns an AI request into a connected evaluation object', async () => {
    render(<CreationCanvas sessionId="evaluation-test" persistence="local" />);

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
    expect(screen.getByText('Draft delivery task added; save to deliver it')).toBeInTheDocument();
  });

  it('edits a website prototype live from the inspector', () => {
    render(<CreationCanvas sessionId="website-editor-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Build the future together' } });
    fireEvent.change(screen.getByLabelText('Call to action'), { target: { value: 'Start building' } });
    expect(screen.getByText('Build the future together')).toBeInTheDocument();
    expect(screen.getByText('Start building')).toBeInTheDocument();
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

    expect(screen.getByText('Add at least two saved projects to compare')).toBeInTheDocument();
  });

  it('gathers staff and agents into an impromptu stand-up frame', () => {
    render(<CreationCanvas sessionId="standup-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Stand-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gather and start stand-up' }));

    expect(screen.getByText('Draft stand-up gathered; save to start it live')).toBeInTheDocument();
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

  it('provides a keyboard-readable structured graph and semantic connections', () => {
    render(<CreationCanvas sessionId="accessible-graph-test" persistence="local" />);

    fireEvent.click(screen.getByText('Accessible canvas outline'));
    expect(screen.getByRole('button', { name: 'Focus Fall campaign workflow' })).toBeInTheDocument();
    expect(screen.getByText(/control connection to Campaign landing page: publishes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Focus Campaign landing page' }));
    expect(screen.getByDisplayValue('Campaign landing page')).toBeInTheDocument();
  });
});
