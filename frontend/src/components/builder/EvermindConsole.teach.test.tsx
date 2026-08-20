import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import {
  EvermindConsole,
  type EvermindConsoleAdapter,
  type EvermindConsoleData,
  type EvermindContributionStatus,
} from '@seanhogg/builderforce-brain-ui';

/**
 * What the "Taught" toast is allowed to claim.
 *
 * `POST /evermind/learn-text` enqueues and returns 200 immediately; the frontier teacher
 * only runs later, inside the coordinator's debounced merge alarm. So the POST's success
 * means "accepted", never "taught" — and the console used to announce "Queued for
 * learning." and then never correct itself, leaving a teach whose teacher 503'd fifteen
 * seconds later looking exactly like one that worked.
 *
 * These tests pin the resolution: the optimistic notice appears, then the per-contribution
 * status poll replaces it with what the merge ACTUALLY did — distilled by a named model,
 * self-learned with no teacher, or a named teacher fault.
 */

const data = (over: Partial<EvermindConsoleData> = {}): EvermindConsoleData => ({
  version: 4,
  seeded: true,
  mode: 'connected',
  contributions: 12,
  inferenceEnabled: false,
  teacherModel: null,
  lastLearnedAt: null,
  pending: 0,
  recent: [],
  ...over,
});

/** An adapter whose teach returns a contribution id and whose status poll is scripted. */
function makeAdapter(
  statuses: EvermindContributionStatus[],
  over: Partial<EvermindConsoleAdapter> = {},
  consoleData: EvermindConsoleData = data(),
): EvermindConsoleAdapter & { teachStatusCalls: number } {
  let call = 0;
  const adapter = {
    teachStatusCalls: 0,
    loadData: async () => consoleData,
    loadSeedModels: async () => [],
    loadTeacherOptions: async () => ({ models: [], isPaid: true }),
    seedFromModel: async () => {},
    setInference: async () => {},
    setMode: async () => {},
    setTeacher: async () => {},
    teach: async () => ({ contributionId: 41 }),
    teachStatus: async () => {
      adapter.teachStatusCalls++;
      const next = statuses[Math.min(call, statuses.length - 1)]!;
      call++;
      return next;
    },
    flush: async () => ({ merged: 0, version: 4 }),
    validate: async () => ({ prompt: '', version: 4, seeded: true, matches: [], primaryId: null, method: 'lexical' as const }),
    ...over,
  } as EvermindConsoleAdapter & { teachStatusCalls: number };
  return adapter;
}

const LONG_TEXT = 'Edited handler.ts and added exponential backoff to the webhook retry path.';

/** Type a transcript and press Teach. */
async function teach(container: HTMLElement) {
  const textarea = await screen.findByPlaceholderText(/Paste the transcript/i);
  fireEvent.change(textarea, { target: { value: LONG_TEXT } });
  fireEvent.click(screen.getByRole('button', { name: /^Teach$/i }));
  return container;
}

describe('teach outcome — the toast tells the truth', () => {
  it('shows the optimistic "Queued" notice first, then resolves it to the distilled result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const adapter = makeAdapter([
        { contributionId: 41, state: 'pending' },
        { contributionId: 41, state: 'merged', kind: 'text', version: 5, distilled: true, teacherModel: 'claude-opus-5' },
      ]);
      const { container } = render(<EvermindConsole adapter={adapter} canManage refreshMs={0} />);
      await teach(container);

      // Interim: all that is actually known at the moment the POST returns.
      await screen.findByText(/Queued for learning/i);

      await vi.advanceTimersByTimeAsync(7_000);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/claude-opus-5 answered it/i));
      expect(screen.queryByText(/Queued for learning/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the teacher FAULT instead of claiming the model was taught', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const adapter = makeAdapter([{
        contributionId: 41, state: 'merged', kind: 'text', version: 5,
        distilled: false, skipReason: 'gateway_error', skipDetail: 'HTTP 503', attemptedTeacherModel: 'vendor/model',
      }]);
      const { container } = render(<EvermindConsole adapter={adapter} canManage refreshMs={0} />);
      await teach(container);

      await vi.advanceTimersByTimeAsync(4_000);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/teacher vendor\/model produced nothing \(gateway_error\)/i));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports self-learning honestly when no teacher is pinned', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const adapter = makeAdapter([{
        contributionId: 41, state: 'merged', kind: 'text', version: 6, distilled: false, skipReason: 'not_pinned',
      }]);
      const { container } = render(<EvermindConsole adapter={adapter} canManage refreshMs={0} />);
      await teach(container);

      await vi.advanceTimersByTimeAsync(4_000);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/no teacher model \(v6\)/i));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the merge could not use the contribution at all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const adapter = makeAdapter([{ contributionId: 41, state: 'dropped' }]);
      const { container } = render(<EvermindConsole adapter={adapter} canManage refreshMs={0} />);
      await teach(container);

      await vi.advanceTimersByTimeAsync(4_000);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Not learned/i));
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling once the outcome is terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const adapter = makeAdapter([{ contributionId: 41, state: 'merged', kind: 'text', version: 5, distilled: false, skipReason: 'not_pinned' }]);
      const { container } = render(<EvermindConsole adapter={adapter} canManage refreshMs={0} />);
      await teach(container);

      await vi.advanceTimersByTimeAsync(4_000);
      await waitFor(() => expect(adapter.teachStatusCalls).toBe(1));
      // A resolved contribution must not keep costing a request every few seconds.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(adapter.teachStatusCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the interim notice when the server cannot answer, rather than inventing one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const adapter = makeAdapter([{ contributionId: 41, state: 'unknown' }]);
      const { container } = render(<EvermindConsole adapter={adapter} canManage refreshMs={0} />);
      await teach(container);

      await vi.advanceTimersByTimeAsync(10_000);
      // "Queued" is the most that is actually known — an `unknown` reply is not evidence
      // of success and must never be rendered as one.
      expect(screen.getByRole('status')).toHaveTextContent(/Queued for learning/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the optimistic toast on a host that does not implement the status poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const adapter = makeAdapter([], { teachStatus: undefined, teach: async () => undefined });
      const { container } = render(<EvermindConsole adapter={adapter} canManage refreshMs={0} />);
      await teach(container);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(screen.getByRole('status')).toHaveTextContent(/Queued for learning/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
