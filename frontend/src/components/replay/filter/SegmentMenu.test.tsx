import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReplayFilter, ReplaySegmentDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { SegmentMenu } from './SegmentMenu';

/** Saved segments: apply, save the current filter, rename, and delete only after confirming. */

const confirmSpy = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<boolean>>());
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));

const phones: ReplayFilter = { all: [{ field: 'device', op: 'eq', value: 'phone' }] };
const pricing: ReplayFilter = { all: [{ field: 'visitedPath', op: 'eq', value: '/pricing' }] };
const segment: ReplaySegmentDto = { id: 'seg-1', name: 'Phones', filter: phones, createdAt: '2026-10-01T00:00:00.000Z' };

beforeEach(() => {
  confirmSpy.mockReset();
  vi.spyOn(replayApi, 'listSegments').mockResolvedValue([segment]);
  vi.spyOn(replayApi, 'createSegment').mockResolvedValue({ ...segment, id: 'seg-2', name: 'Pricing', filter: pricing });
  vi.spyOn(replayApi, 'updateSegment').mockResolvedValue({ ...segment, name: 'Mobile' });
  vi.spyOn(replayApi, 'deleteSegment').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openMenu(filter: ReplayFilter, onApply = vi.fn()) {
  render(<SegmentMenu siteId="site-1" filter={filter} onApply={onApply} />);
  fireEvent.click(screen.getByRole('button', { name: /replay\.segments\.button/ }));
  await screen.findByRole('button', { name: 'replay.segments.applyAria Phones' });
  return onApply;
}

describe('SegmentMenu', () => {
  it('applies a saved segment', async () => {
    const onApply = await openMenu(pricing);
    fireEvent.click(screen.getByRole('button', { name: 'replay.segments.applyAria Phones' }));
    expect(onApply).toHaveBeenCalledWith(phones);
  });

  it('saves the current filter under a name', async () => {
    await openMenu(pricing);
    fireEvent.change(screen.getByRole('textbox', { name: 'replay.segments.nameAria' }), { target: { value: ' Pricing ' } });
    fireEvent.click(screen.getByRole('button', { name: 'replay.segments.save' }));
    await waitFor(() => expect(replayApi.createSegment).toHaveBeenCalledWith('site-1', { name: 'Pricing', filter: pricing }));
    await waitFor(() => expect(replayApi.listSegments).toHaveBeenCalledTimes(2));
  });

  it('cannot save an empty filter', async () => {
    await openMenu({ all: [] });
    fireEvent.change(screen.getByRole('textbox', { name: 'replay.segments.nameAria' }), { target: { value: 'Everything' } });
    expect(screen.getByRole('button', { name: 'replay.segments.save' })).toBeDisabled();
  });

  it('renames a segment', async () => {
    await openMenu(pricing);
    fireEvent.click(screen.getByRole('button', { name: 'replay.segments.renameAria Phones' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'replay.segments.renameAria Phones' }), { target: { value: 'Mobile' } });
    fireEvent.click(screen.getByRole('button', { name: 'replay.segments.saveName' }));
    await waitFor(() => expect(replayApi.updateSegment).toHaveBeenCalledWith('site-1', 'seg-1', { name: 'Mobile' }));
  });

  it('deletes only after the confirm is accepted', async () => {
    await openMenu(pricing);
    confirmSpy.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'replay.segments.deleteAria Phones' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy.mock.calls[0]![0]).toEqual(expect.objectContaining({ destructive: true }));
    expect(replayApi.deleteSegment).not.toHaveBeenCalled();

    confirmSpy.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'replay.segments.deleteAria Phones' }));
    await waitFor(() => expect(replayApi.deleteSegment).toHaveBeenCalledWith('site-1', 'seg-1'));
  });
});
