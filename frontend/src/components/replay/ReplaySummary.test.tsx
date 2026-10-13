import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { replayApi } from '@/lib/replayApi';
import { ApiRequestError } from '@/lib/apiClient';
import { ReplaySummary } from './ReplaySummary';

/**
 * A recording's AI summary (D13): only on request, every `#ord` citation is a
 * button that seeks the player to that mark, and the daily limit (429) / an
 * ungrounded answer (503) read in place.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReplaySummary', () => {
  it('summarizes on request and a citation seeks the player', async () => {
    vi.spyOn(replayApi, 'summarizeRecording').mockResolvedValue({
      recordingId: 'rec-1',
      summary: 'They rage-clicked Buy #1. Then they left from pricing #3.',
      citations: [{ ord: 1, atMs: 12_000 }, { ord: 3, atMs: 65_000 }],
      model: null,
      generatedAt: '2026-10-13T00:00:00.000Z',
    });
    const onSeek = vi.fn();
    render(<ReplaySummary siteId="site-1" recordingId="rec-1" onSeek={onSeek} />);
    expect(replayApi.summarizeRecording).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /replay\.summary\.summarize/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'replay.summary.citeAria 0:12' }));
    expect(onSeek).toHaveBeenCalledWith(12_000);
    fireEvent.click(screen.getByRole('button', { name: 'replay.summary.citeAria 1:05' }));
    expect(onSeek).toHaveBeenLastCalledWith(65_000);
    expect(replayApi.summarizeRecording).toHaveBeenCalledWith('site-1', 'rec-1', { regenerate: false });
    // The sentence text stays; the raw `#ord` markers do not.
    expect(screen.getByText(/They rage-clicked Buy/)).toBeInTheDocument();
    expect(screen.queryByText(/#1/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /replay\.summary\.regenerate/ }));
    expect(replayApi.summarizeRecording).toHaveBeenLastCalledWith('site-1', 'rec-1', { regenerate: true });
  });

  it('says the daily limit is reached on 429', async () => {
    vi.spyOn(replayApi, 'summarizeRecording').mockRejectedValue(new ApiRequestError('limit', 429));
    render(<ReplaySummary siteId="site-1" recordingId="rec-1" onSeek={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /replay\.summary\.summarize/ }));
    expect(await screen.findByText('replay.summary.limit')).toBeInTheDocument();
  });

  it('says no grounded summary could be written on 503', async () => {
    vi.spyOn(replayApi, 'summarizeRecording').mockRejectedValue(new ApiRequestError('The model wrote no cited sentence', 503, 'summary_uncited'));
    render(<ReplaySummary siteId="site-1" recordingId="rec-1" onSeek={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /replay\.summary\.summarize/ }));
    expect(await screen.findByText('replay.summary.uncited')).toBeInTheDocument();
  });
});
