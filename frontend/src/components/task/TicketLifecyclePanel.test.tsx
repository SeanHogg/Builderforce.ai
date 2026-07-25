import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TicketLifecyclePanel, verdictBanner } from './TicketLifecyclePanel';
import { tasksApi, type TicketAutonomyVerdict, type TicketLifecycle } from '@/lib/builderforceApi';

vi.mock('@/lib/builderforceApi', () => ({
  tasksApi: { lifecycle: vi.fn() },
}));

function makeVerdict(over: Partial<TicketAutonomyVerdict> = {}): TicketAutonomyVerdict {
  return {
    origin: 'agent',
    currentStatus: 'done',
    isTerminal: true,
    autonomousHops: 3,
    humanHops: 0,
    backwardHops: 0,
    runsDispatched: 2,
    runsCompleted: 2,
    runsFailed: 0,
    hasLiveRun: false,
    reachedTerminal: true,
    fullyAutonomous: true,
    progressedAutonomously: true,
    stalled: false,
    stallReason: null,
    stallText: null,
    ...over,
  };
}

describe('verdictBanner', () => {
  it('claims full autonomy only with zero human hops', () => {
    expect(verdictBanner(makeVerdict()).key).toBe('fullyAutonomous');
  });

  it('reports a human-driven ticket when autonomy never moved it', () => {
    const b = verdictBanner(makeVerdict({
      fullyAutonomous: false, progressedAutonomously: false,
      autonomousHops: 0, humanHops: 4,
    }));
    expect(b.key).toBe('humanDriven');
    expect(b.values.hops).toBe(4);
  });

  it('separates a stalled partial run from one still working', () => {
    const base = {
      fullyAutonomous: false, reachedTerminal: false, isTerminal: false,
      currentStatus: 'in_progress', autonomousHops: 2, humanHops: 0,
    };
    expect(verdictBanner(makeVerdict({ ...base, stalled: true })).key).toBe('partialStalled');
    expect(verdictBanner(makeVerdict({ ...base, stalled: false, hasLiveRun: true })).key).toBe('partialRunning');
  });

  it('says "never moved" rather than attributing hops that do not exist', () => {
    const b = verdictBanner(makeVerdict({
      fullyAutonomous: false, progressedAutonomously: false, reachedTerminal: false,
      isTerminal: false, currentStatus: 'backlog', autonomousHops: 0, humanHops: 0,
      runsDispatched: 0, runsCompleted: 0, stalled: true,
    }));
    expect(b.key).toBe('noMovement');
  });

  it('credits human help on a ticket both sides moved', () => {
    const b = verdictBanner(makeVerdict({ fullyAutonomous: false, autonomousHops: 2, humanHops: 1 }));
    expect(b.key).toBe('assisted');
    expect(b.values).toEqual({ humanHops: 1, totalHops: 3 });
  });
});

describe('TicketLifecyclePanel', () => {
  const lifecycle: TicketLifecycle = {
    taskId: 7,
    projectId: 1,
    title: 'Ship the audit read',
    key: 'BF-7',
    createdAt: '2026-07-01T10:00:00.000Z',
    events: [
      {
        at: '2026-07-01T10:00:00.000Z', kind: 'created', actorKind: 'cloud_agent',
        actorName: 'AI Manager', source: 'activity_log',
      },
      {
        at: '2026-07-01T11:00:00.000Z', kind: 'lane_moved', actorKind: 'system',
        actorName: 'coordinator', fromStatus: 'todo', toStatus: 'in_progress',
        isBackward: false, source: 'task_status_transitions',
      },
    ],
    verdict: makeVerdict(),
  };

  it('renders the verdict, the hop tiles and a provenance chip per event', async () => {
    vi.mocked(tasksApi.lifecycle).mockResolvedValue(lifecycle);
    const { getByText, getAllByText } = render(<TicketLifecyclePanel taskId={7} onClose={() => {}} />);

    await waitFor(() => {
      // The verdict sentence, not the numbers. (The i18n test mock appends the
      // interpolated values after the key, hence the regex.)
      expect(getByText(/ticketLifecycle\.verdict\.fullyAutonomous\b/)).toBeTruthy();
    });
    expect(tasksApi.lifecycle).toHaveBeenCalledWith(7);
    // Hop split tiles.
    expect(getByText('ticketLifecycle.stats.autonomousHops')).toBeTruthy();
    expect(getByText('ticketLifecycle.stats.humanHops')).toBeTruthy();
    // Chain of custody: one source chip per event, naming the table it came from.
    expect(getByText('activity_log')).toBeTruthy();
    expect(getByText('task_status_transitions')).toBeTruthy();
    expect(getAllByText(/ticketLifecycle\.kind\./).length).toBe(2);
  });

  it('surfaces the stall gate for a ticket sitting short of Done', async () => {
    vi.mocked(tasksApi.lifecycle).mockResolvedValue({
      ...lifecycle,
      verdict: makeVerdict({
        fullyAutonomous: false, reachedTerminal: false, isTerminal: false,
        currentStatus: 'todo', stalled: true, stallReason: 'no_agent',
        stallText: 'No run: the lane has no staffed agent.',
      }),
    });
    const { getByText } = render(<TicketLifecyclePanel taskId={7} onClose={() => {}} />);

    await waitFor(() => {
      expect(getByText('ticketLifecycle.stall.title')).toBeTruthy();
    });
    // Localized gate copy wins over the server's English sentence.
    expect(getByText('board.triage.reason.no_agent')).toBeTruthy();
  });

  it('fetches nothing while closed', () => {
    vi.mocked(tasksApi.lifecycle).mockClear();
    render(<TicketLifecyclePanel taskId={null} onClose={() => {}} />);
    expect(tasksApi.lifecycle).not.toHaveBeenCalled();
  });
});
