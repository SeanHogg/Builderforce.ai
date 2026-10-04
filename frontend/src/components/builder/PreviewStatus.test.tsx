import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { clearBuildFailures, recordBuildFailure } from '@/lib/buildDiagnostics';

const docked = { ask: vi.fn(), seedComposer: vi.fn(), reveal: vi.fn(), registerComposer: vi.fn() };
let hasDockedBrain = true;
vi.mock('@/lib/brain/dockedBrain', () => ({ useDockedBrain: () => (hasDockedBrain ? docked : null) }));

import { PreviewStatus } from './PreviewStatus';

const PROJECT = 7;

describe('PreviewStatus', () => {
  beforeEach(() => {
    hasDockedBrain = true;
    docked.ask.mockReset();
    docked.seedComposer.mockReset();
    clearBuildFailures(PROJECT);
  });
  afterEach(() => cleanup());

  // "Fix it for me" sends the error the preview recorded, so Brain starts from the
  // real failure instead of a description of it.
  it('a stopped preview offers "Fix it for me", which sends the recorded error to Brain', () => {
    recordBuildFailure(PROJECT, { source: 'build', message: 'SyntaxError: Unexpected token', at: 'src/App.jsx:42:7' });
    render(<PreviewStatus state="failed" step={null} projectId={PROJECT} onRetry={vi.fn()} />);

    expect(screen.getByText('SyntaxError: Unexpected token')).toBeTruthy();
    fireEvent.click(screen.getByText(/ide\.workspace\.fixForMe/));
    expect(docked.ask).toHaveBeenCalledTimes(1);
    const sent = docked.ask.mock.calls[0][0] as string;
    expect(sent).toContain('ide.workspace.fixPrompt');
    expect(sent).toContain('SyntaxError: Unexpected token');
    expect(sent).toContain('src/App.jsx:42:7');
  });

  it('offers Versions only when the host can open them', () => {
    const onOpenVersions = vi.fn();
    const { rerender } = render(<PreviewStatus state="failed" step={null} projectId={PROJECT} onRetry={vi.fn()} />);
    expect(screen.queryByText(/ide\.workspace\.versions/)).toBeNull();

    rerender(<PreviewStatus state="failed" step={null} projectId={PROJECT} onRetry={vi.fn()} onOpenVersions={onOpenVersions} />);
    fireEvent.click(screen.getByText(/ide\.workspace\.versions/));
    expect(onOpenVersions).toHaveBeenCalled();
  });

  // Without a docked Brain there is nobody to ask, so the button does not exist.
  it('has no "Fix it for me" without a docked Brain', () => {
    hasDockedBrain = false;
    recordBuildFailure(PROJECT, { source: 'build', message: 'boom' });
    render(<PreviewStatus state="failed" step={null} projectId={PROJECT} onRetry={vi.fn()} />);
    expect(screen.queryByText(/ide\.workspace\.fixForMe/)).toBeNull();
  });

  // A suggestion fills the chat for the person to finish; it never sends.
  it('an empty project suggests starting points that fill the chat', () => {
    render(<PreviewStatus state="empty" step={null} projectId={PROJECT} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByText('ide.workspace.suggestion.portfolio.label'));
    expect(docked.seedComposer).toHaveBeenCalledWith('ide.workspace.suggestion.portfolio.prompt');
    expect(docked.ask).not.toHaveBeenCalled();
  });
});
