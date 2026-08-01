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
    expect(screen.getByText('Campaign landing page')).toBeInTheDocument();
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
    render(<CreationCanvas sessionId="feature-test" />);
    fireEvent.change(screen.getByLabelText('Ask Brain about this canvas'), { target: { value: 'Create a visual summary of the top 10 requested features and mockups' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Brain' }));
    act(() => vi.advanceTimersByTime(900));

    expect(screen.getByDisplayValue('Top 10 feature mockups')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to project and assign' }));
    expect(screen.getByText('Mockup attached and delivery task assigned')).toBeInTheDocument();
  });
});
