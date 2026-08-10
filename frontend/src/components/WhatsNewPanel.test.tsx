import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsNewPanel from './WhatsNewPanel';
import type { ReleaseNote } from '@/lib/releaseNotesApi';

const { fetchReleaseNotes } = vi.hoisted(() => ({
  fetchReleaseNotes: vi.fn<() => Promise<ReleaseNote[]>>(),
}));

vi.mock('@/lib/releaseNotesApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/releaseNotesApi')>(),
  fetchReleaseNotes,
}));

vi.mock('@/lib/betaPrograms', () => ({
  useBetaPrograms: () => ({ betas: [] }),
}));

const makeNote = (overrides: Partial<ReleaseNote>): ReleaseNote => ({
  id: 'note-1',
  version: '2026.8.1',
  title: 'Collaborative canvas',
  body: 'Build together in real time.',
  category: 'new',
  stage: 'live',
  betaOptIn: false,
  betaTerms: null,
  stageEndsAt: null,
  publishedAt: '2026-08-08T12:00:00.000Z',
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z',
  ...overrides,
});

describe('WhatsNewPanel', () => {
  beforeEach(() => {
    fetchReleaseNotes.mockResolvedValue([
      makeNote({}),
      makeNote({
        id: 'note-2',
        version: '2026.7.9',
        title: 'Faster deploys',
        body: 'Build caching cuts deployment time.',
        category: 'improvement',
        publishedAt: '2026-07-24T12:00:00.000Z',
      }),
    ]);
  });

  it('searches and filters the release catalog', async () => {
    render(<WhatsNewPanel open onClose={vi.fn()} />);

    expect(await screen.findByText('Collaborative canvas')).toBeInTheDocument();
    expect(screen.getByText('Faster deploys')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('whatsNew.searchPlaceholder'), {
      target: { value: '2026.7.9' },
    });
    expect(screen.queryByText('Collaborative canvas')).not.toBeInTheDocument();
    expect(screen.getByText('Faster deploys')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('whatsNew.searchPlaceholder'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'whatsNew.categories.new' }));
    expect(screen.getByText('Collaborative canvas')).toBeInTheDocument();
    expect(screen.queryByText('Faster deploys')).not.toBeInTheDocument();
  });
});
