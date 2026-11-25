import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudioSyncStatus } from './StudioSyncStatus';
import type { WebSyncState } from '@/lib/localFirst/webSyncDriver';

const STATES: WebSyncState[] = ['idle', 'syncing', 'held', 'offline', 'denied', 'unbound', 'busy'];

describe('StudioSyncStatus', () => {
  it.each(STATES)('says the %s state in its own words and nothing else', (state) => {
    render(<StudioSyncStatus state={state} pending={0} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-state', state);
    // The global intl mock echoes `namespace.key`: this is the localized sentence for the state.
    expect(status.textContent).toContain(`creationCanvas.sync.state.${state}`);
    expect(status.textContent).not.toContain('creationCanvas.sync.pending');
  });

  it('shows how many changes are still owed to the server', () => {
    render(<StudioSyncStatus state="held" pending={3} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('creationCanvas.sync.state.held');
    expect(status.textContent).toMatch(/creationCanvas\.sync\.pending 3/);
  });

  it('keeps an outage calm: a held count is not an alert', () => {
    render(<StudioSyncStatus state="held" pending={2} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fits a phone: the chip may shrink to the viewport and never forces a horizontal scroll', () => {
    render(<StudioSyncStatus state="offline" pending={12} />);
    const style = screen.getByRole('status').style;
    expect(style.maxWidth).toBe('calc(100vw - 32px)');
  });
});
