import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UseOfflineModelResult } from '@/hooks/useOfflineModel';
import { OfflineModelAction } from './OfflineModelAction';

// The global next-intl mock returns the KEY, so these assert which message was chosen.
function offline(patch: Partial<UseOfflineModelResult>): UseOfflineModelResult {
  return { state: 'idle', fraction: null, sizeBytes: null, error: null, signedIn: true, start: vi.fn(async () => {}), cancel: vi.fn(), ...patch };
}

describe('OfflineModelAction', () => {
  it('offers the download and starts it', () => {
    const o = offline({});
    render(<OfflineModelAction offline={o} />);
    fireEvent.click(screen.getByRole('button', { name: /offlineAction/ }));
    expect(o.start).toHaveBeenCalled();
  });

  it('shows progress with a cancel while downloading', () => {
    const o = offline({ state: 'downloading', fraction: 0.4 });
    render(<OfflineModelAction offline={o} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/ }));
    expect(o.cancel).toHaveBeenCalled();
  });

  it('reports availability with its size', () => {
    render(<OfflineModelAction offline={offline({ state: 'available', sizeBytes: 2048 })} />);
    expect(screen.getByRole('status').textContent).toContain('offlineReadySize');
  });

  it('shows the error with a retry', () => {
    render(<OfflineModelAction offline={offline({ state: 'error', error: 'boom' })} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /offlineRetry/ })).toBeTruthy();
  });

  it('disables the action and says why when signed out', () => {
    render(<OfflineModelAction offline={offline({ signedIn: false })} />);
    expect((screen.getByRole('button', { name: /offlineAction/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/offlineNeedsAccount/).length).toBeGreaterThan(0);
  });
});
