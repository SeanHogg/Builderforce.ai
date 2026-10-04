import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { MediaReviewCard } from './MediaReviewCard';

const ITEM = {
  id: 'm1', kind: 'image' as const, status: 'ready' as const, prompt: 'a bakery hero',
  url: 'https://x/m1.png', storageKey: null, mimeType: null, width: 1792, height: 1024,
  durationSeconds: null, model: null, jobId: null, error: null, usedAt: null, createdAt: '2026-10-04T20:00:00.000Z',
};

describe('MediaReviewCard', () => {
  it('shows the asset and answers "use"', () => {
    const decide = vi.fn();
    render(<MediaReviewCard review={{ item: ITEM, decide }} />);
    expect(screen.getByRole('img', { name: 'a bakery hero' })).toHaveAttribute('src', ITEM.url);
    fireEvent.click(screen.getByRole('button', { name: 'useIt' }));
    expect(decide).toHaveBeenCalledWith({ action: 'use' });
  });

  it('retries with the prompt as the person edited it', () => {
    const decide = vi.fn();
    render(<MediaReviewCard review={{ item: ITEM, decide }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a bakery hero at dusk' } });
    fireEvent.click(screen.getByRole('button', { name: 'tryAgain' }));
    expect(decide).toHaveBeenCalledWith({ action: 'retry', prompt: 'a bakery hero at dusk' });
  });

  it('discards', () => {
    const decide = vi.fn();
    render(<MediaReviewCard review={{ item: ITEM, decide }} />);
    fireEvent.click(screen.getByRole('button', { name: 'discard' }));
    expect(decide).toHaveBeenCalledWith({ action: 'discard' });
  });
});
