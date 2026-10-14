import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DEFAULT_REPLAY_SITE_SETTINGS,
  replayMomentFromDescription,
  type ReplayRecordingDto,
  type ReplaySiteDto,
} from '@builderforce/interaction-contract';
import { tasksApi } from '@/lib/builderforceApi';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { TicketFromMoment, momentAt } from './TicketFromMoment';

/**
 * PRD 33 S3 + §5.3.4 — a ticket from a replay moment: filed on the hosted app's
 * project with a link back to the second and the moment in the description; an
 * external site with no project keeps copy-link only.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));

const SITE = '11111111-1111-4111-8111-111111111111';
const site = (over: Partial<ReplaySiteDto> = {}): ReplaySiteDto => ({
  id: SITE, kind: 'hosted', projectId: 42, label: 'Shop', status: 'active',
  settings: DEFAULT_REPLAY_SITE_SETTINGS, allowedOrigins: [], publicKey: null, createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const recording = {
  id: 'rec-1',
  entryPath: '/',
  releaseKey: 'rel-abc',
  marks: [
    { kind: 'page', key: '/', atMs: 0 },
    { kind: 'page', key: '/pricing', atMs: 5_000 },
    { kind: 'rage', key: 'button.buy', label: 'Buy', atMs: 11_000 },
  ],
} as unknown as ReplayRecordingDto;

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  vi.restoreAllMocks();
  vi.spyOn(tasksApi, 'create').mockResolvedValue({ id: 9 } as never);
});

describe('momentAt', () => {
  it('names the moment by the signal just before the playhead, on the route it happened', () => {
    const { moment, label } = momentAt(recording, SITE, 12_400);
    expect(label).toBe('Buy');
    expect(moment).toEqual({ siteId: SITE, recordingId: 'rec-1', atMs: 12_400, releaseKey: 'rel-abc', metric: 'frustrated', route: '/pricing' });
  });

  it('falls back to the route and the conversions metric with no signal nearby', () => {
    const { moment, label } = momentAt(recording, SITE, 4_000);
    expect(label).toBe('/');
    expect(moment.metric).toBe('conversions');
  });
});

describe('TicketFromMoment', () => {
  it('a hosted site: creates a task on its project with the link and the moment', async () => {
    vi.spyOn(replaySitesApi, 'get').mockResolvedValue(site());
    render(<TicketFromMoment siteId={SITE} recording={recording} currentMs={12_400} />);
    fireEvent.click(await screen.findByRole('button', { name: /replay\.ticket\.raise/ }));
    await waitFor(() => expect(tasksApi.create).toHaveBeenCalledTimes(1));

    const body = vi.mocked(tasksApi.create).mock.calls[0]![0];
    expect(body.projectId).toBe(42);
    expect(body.title).toBe('replay.ticket.title Buy 0:12');
    expect(body.description).toContain(`/apps/insights?site=${SITE}&panel=recording:rec-1&t=12`);
    expect(replayMomentFromDescription(body.description)).toMatchObject({ recordingId: 'rec-1', atMs: 12_400, releaseKey: 'rel-abc', metric: 'frustrated' });
    expect(toast.success).toHaveBeenCalled();
  });

  it('an external site with no project: renders nothing — copy-link only', async () => {
    const get = vi.spyOn(replaySitesApi, 'get').mockResolvedValue(site({ kind: 'external', projectId: null }));
    const { container } = render(<TicketFromMoment siteId={SITE} recording={recording} currentMs={0} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(tasksApi.create).not.toHaveBeenCalled();
  });

  it('says so when the ticket could not be created', async () => {
    vi.spyOn(replaySitesApi, 'get').mockResolvedValue(site());
    vi.mocked(tasksApi.create).mockRejectedValue(new Error('nope'));
    render(<TicketFromMoment siteId={SITE} recording={recording} currentMs={12_400} />);
    fireEvent.click(await screen.findByRole('button', { name: /replay\.ticket\.raise/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
