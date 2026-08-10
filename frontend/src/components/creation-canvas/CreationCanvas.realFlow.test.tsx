import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalCreationSession } from '@/lib/creationSessions';
import { CreationCanvas } from './CreationCanvas';

// No suite-level timeout override — see the note in `CreationCanvas.test.tsx`:
// the 15s cap was a mitigation for a render loop that no longer exists, and it
// now only cuts off heavy mounts when this file runs alongside the rest of
// `src/components` rather than on its own.
describe('CreationCanvas with the real XYFlow store', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('hydrates an anonymous local Session without an update-depth loop', async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args); });
    const sessionId = createLocalCreationSession('Build a new website');

    render(<CreationCanvas sessionId={sessionId} persistence="local" />);

    await waitFor(() => expect(screen.getAllByText('Build a new website').length).toBeGreaterThan(0));
    // The initial prompt auto-submits after hydration. Stay mounted through that
    // update as well; the production failure appeared after the first store sync.
    await new Promise((resolve) => window.setTimeout(resolve, 1_200));
    expect(errors.map((args) => args.join(' ')).join('\n')).not.toMatch(/maximum update depth|error #185/i);
  });
});
