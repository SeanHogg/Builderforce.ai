import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalCreationSession } from '@/lib/creationSessions';
import { CreationCanvas } from './CreationCanvas';

describe('CreationCanvas with the real XYFlow store', { timeout: 15_000 }, () => {
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
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    expect(errors.map((args) => args.join(' ')).join('\n')).not.toMatch(/maximum update depth|error #185/i);
  });
});
