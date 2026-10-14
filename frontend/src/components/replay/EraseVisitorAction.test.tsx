import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { replayApi } from '@/lib/replayApi';
import { EraseVisitorAction } from './EraseVisitorAction';

/**
 * "Erase this visitor": asks first (useConfirm), then erases through the ONE
 * client with the site it was opened on, and says how many recordings went.
 */

const confirmSpy = vi.fn(async () => true);
const gate = vi.hoisted(() => ({ capability: '' }));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));
vi.mock('@/components/RoleGate', () => ({
  RoleGate: ({ capability, children }: { capability: string; children: React.ReactNode }) => {
    gate.capability = capability;
    return <>{children}</>;
  },
}));

beforeEach(() => {
  confirmSpy.mockClear();
  confirmSpy.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EraseVisitorAction', () => {
  it('confirms, erases this site’s recordings of the visitor and reports the count', async () => {
    const erase = vi.spyOn(replayApi, 'eraseVisitor').mockResolvedValue({ visitorId: 'visitor_0001', erased: 3 });
    const onErased = vi.fn();
    render(<EraseVisitorAction siteId="site-1" visitorId="visitor_0001" onErased={onErased} />);
    fireEvent.click(screen.getByRole('button', { name: 'insights.eraseVisitor.action' }));
    expect(await screen.findByText('insights.eraseVisitor.done 3')).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(erase).toHaveBeenCalledWith('site-1', 'visitor_0001');
    expect(onErased).toHaveBeenCalledTimes(1);
    expect(gate.capability).toBe('insights.manageSites');
  });

  it('erases nothing when the confirm is declined', async () => {
    confirmSpy.mockResolvedValue(false);
    const erase = vi.spyOn(replayApi, 'eraseVisitor');
    render(<EraseVisitorAction siteId="site-1" visitorId="visitor_0001" />);
    fireEvent.click(screen.getByRole('button', { name: 'insights.eraseVisitor.action' }));
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(erase).not.toHaveBeenCalled();
  });
});
