import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationCanvas } from './CreationCanvas';

describe('CreationCanvas', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('renders live workflow, website, dashboard, collaborators, and agent controls', () => {
    render(<CreationCanvas sessionId="campaign-test" />);

    expect(screen.getByText('Fall campaign workflow')).toBeInTheDocument();
    expect(screen.getAllByText('Campaign landing page').length).toBeGreaterThan(0);
    expect(screen.getByText('Campaign forecast')).toBeInTheDocument();
    expect(screen.getByLabelText('Active collaborators')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Campaign Strategist')).toBeInTheDocument();
  });

  it('adds a selected object from the palette', () => {
    render(<CreationCanvas sessionId="palette-test" />);

    fireEvent.click(screen.getByRole('button', { name: 'Dataset' }));

    expect(screen.getByDisplayValue('Imported dataset.csv')).toBeInTheDocument();
  });

  it('turns an AI request into a connected evaluation object', () => {
    render(<CreationCanvas sessionId="evaluation-test" />);

    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));
    act(() => vi.advanceTimersByTime(900));

    expect(screen.getByDisplayValue('Canvas evaluation')).toBeInTheDocument();
    expect(screen.getByText('Evaluation added to canvas')).toBeInTheDocument();
  });

  it('expands optional project context into related live objects', () => {
    render(<CreationCanvas sessionId="project-test" />);

    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add all related items' }));

    expect(screen.getByText('Project relationships added to canvas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BuilderForce launch')).toBeInTheDocument();
  });

  it('creates feature mockups and dispatches their delivery from the session', () => {
    render(<CreationCanvas sessionId="feature-test" persistence="local" />);
    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Create a visual summary of the top 10 requested features and mockups' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));
    act(() => vi.advanceTimersByTime(900));

    expect(screen.getByDisplayValue('Top 10 feature mockups')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to project and assign' }));
    expect(screen.getByText('Draft delivery task added; save to deliver it')).toBeInTheDocument();
  });

  it('edits a website prototype live from the inspector', () => {
    render(<CreationCanvas sessionId="website-editor-test" />);
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Build the future together' } });
    fireEvent.change(screen.getByLabelText('Call to action'), { target: { value: 'Start building' } });
    expect(screen.getByText('Build the future together')).toBeInTheDocument();
    expect(screen.getByText('Start building')).toBeInTheDocument();
  });

  it('imports tabular data and creates a connected visualization', async () => {
    render(<CreationCanvas sessionId="dataset-visual-test" />);
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
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: /Product discovery/i }));

    expect(screen.getByText('Product discovery added from Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Customer feedback')).toBeInTheDocument();
    expect(screen.getByText('Opportunity evaluation')).toBeInTheDocument();
  });

  it('customizes and saves a reusable spatial frame', () => {
    render(<CreationCanvas sessionId="frame-preset-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'Frame' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Decision review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as reusable frame' }));
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));

    expect(screen.getByText('Reusable frame saved to your template library')).toBeInTheDocument();
    expect(screen.getByText('Your reusable frames')).toBeInTheDocument();
    expect(screen.getByText('Private custom frame')).toBeInTheDocument();
  });
});
