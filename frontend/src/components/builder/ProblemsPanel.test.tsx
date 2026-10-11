import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { clearBuildFailures, readBuildFailures, recordBuildFailure } from '@/lib/buildDiagnostics';

const docked = { ask: vi.fn(), seedComposer: vi.fn(), reveal: vi.fn(), registerComposer: vi.fn() };
let hasDockedBrain = true;
vi.mock('@/lib/brain/dockedBrain', () => ({ useDockedBrain: () => (hasDockedBrain ? docked : null) }));

import { ProblemsPanel } from './ProblemsPanel';

const PROJECT = 11;

describe('ProblemsPanel', () => {
  beforeEach(() => {
    hasDockedBrain = true;
    docked.ask.mockReset();
    clearBuildFailures(PROJECT);
  });
  afterEach(() => cleanup());

  // A row's fix button sends THAT failure, as recorded, to the docked Brain.
  it('each problem can be handed to Brain to fix', () => {
    recordBuildFailure(PROJECT, { source: 'runtime', message: 'Failed to load script: /src/main.jsx', at: 'index.html:12' });
    render(<ProblemsPanel projectId={PROJECT} failures={readBuildFailures(PROJECT)} />);

    fireEvent.click(screen.getByRole('button', { name: 'builderPanels.fixWithBrain' }));
    expect(docked.ask).toHaveBeenCalledTimes(1);
    const sent = docked.ask.mock.calls[0][0] as string;
    expect(sent).toContain('ide.workspace.fixPrompt');
    expect(sent).toContain('Failed to load script: /src/main.jsx');
    expect(sent).toContain('index.html:12');
  });

  // Without a docked Brain there is nobody to ask, so the button does not exist.
  it('has no fix button without a docked Brain', () => {
    hasDockedBrain = false;
    recordBuildFailure(PROJECT, { source: 'build', message: 'boom' });
    render(<ProblemsPanel projectId={PROJECT} failures={readBuildFailures(PROJECT)} />);
    expect(screen.queryByRole('button', { name: 'builderPanels.fixWithBrain' })).toBeNull();
  });
});
