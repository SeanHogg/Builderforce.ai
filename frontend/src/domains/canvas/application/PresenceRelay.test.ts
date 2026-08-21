/**
 * The coalescing throttle, with time under the test's control.
 *
 * This is the whole reason the relay is a unit rather than a closure: "a move
 * inside the window is remembered and flushed at the end of it" is a statement
 * about WHEN, and a test that cannot move the clock can only assert that
 * something eventually happened.
 */

import { describe, expect, it, vi } from 'vitest';
import { createPresenceRelay, type PresenceClock } from './PresenceRelay';
import type { CanvasPresenceState } from '@builderforce/creation-canvas-contract';

/** A clock that only moves when the test says so, and runs timers on demand. */
function fakeClock() {
  let time = 0;
  const timers = new Map<number, { run: () => void; at: number }>();
  let nextHandle = 1;
  const clock: PresenceClock = {
    now: () => time,
    schedule: (run, delayMs) => {
      const handle = nextHandle++;
      timers.set(handle, { run, at: time + delayMs });
      return handle;
    },
    cancel: (handle) => { timers.delete(handle); },
  };
  return {
    clock,
    pending: () => timers.size,
    advance(ms: number) {
      time += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= time) { timers.delete(handle); timer.run(); }
      }
    },
  };
}

function relay() {
  const clock = fakeClock();
  const sent: CanvasPresenceState[] = [];
  const open = { value: true };
  const subject = createPresenceRelay(
    { deliver: (state) => { if (!open.value) return false; sent.push(state); return true; } },
    { intervalMs: 50, clock: clock.clock },
  );
  return { subject, sent, open, ...clock };
}

describe('createPresenceRelay', () => {
  it('sends the first frame immediately', () => {
    const { subject, sent } = relay();
    subject.send({ cursor: { x: 1, y: 1 } });
    expect(sent).toEqual([{ cursor: { x: 1, y: 1 } }]);
  });

  it('COALESCES inside the window instead of dropping', () => {
    // Dropping leaves everyone else's cursor stopped wherever the last frame
    // happened to land whenever someone moves fast and then stops — which is
    // exactly when a cursor is being watched.
    const { subject, sent, advance } = relay();
    subject.send({ cursor: { x: 1, y: 1 } });
    subject.send({ cursor: { x: 2, y: 2 } });
    subject.send({ cursor: { x: 3, y: 3 } });

    expect(sent).toHaveLength(1);
    advance(50);
    expect(sent[1]).toEqual({ cursor: { x: 3, y: 3 } });
  });

  it('merges DIFFERENT facts arriving in the same window', () => {
    // A cursor move and a typing flag 5ms apart are two things the relay knows,
    // not two candidates for one slot.
    const { subject, sent, advance } = relay();
    subject.send({ cursor: { x: 1, y: 1 } });
    subject.send({ cursor: { x: 4, y: 4 } });
    subject.send({ typing: true });
    advance(50);

    expect(sent[1]).toEqual({ cursor: { x: 4, y: 4 }, typing: true });
  });

  it('sends immediately again once the window has passed', () => {
    const { subject, sent, advance } = relay();
    subject.send({ cursor: { x: 1, y: 1 } });
    advance(60);
    subject.send({ cursor: { x: 5, y: 5 } });
    expect(sent).toHaveLength(2);
  });

  it('is silent while the channel is closed, and says nothing about it', () => {
    // The 8-second presence poll is the fallback, so a closed socket is an
    // ordinary state rather than an error worth surfacing.
    const { subject, sent, open } = relay();
    open.value = false;
    expect(() => subject.send({ cursor: { x: 1, y: 1 } })).not.toThrow();
    expect(sent).toEqual([]);
  });

  it('drops a pending flush on dispose', () => {
    const { subject, sent, advance, pending } = relay();
    subject.send({ cursor: { x: 1, y: 1 } });
    subject.send({ cursor: { x: 2, y: 2 } });
    subject.dispose();

    expect(pending()).toBe(0);
    advance(100);
    expect(sent).toHaveLength(1);
  });

  it('never queues more than one timer for a burst', () => {
    const { subject, pending } = relay();
    for (let index = 0; index < 40; index += 1) subject.send({ cursor: { x: index, y: index } });
    expect(pending()).toBe(1);
  });
});

describe('the browser clock', () => {
  it('is the default, so a caller does not have to know the relay has one', () => {
    vi.useFakeTimers();
    const sent: CanvasPresenceState[] = [];
    const subject = createPresenceRelay({ deliver: (state) => { sent.push(state); return true; } }, { intervalMs: 50 });
    subject.send({ typing: true });
    subject.send({ typing: false });
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([{ typing: true }, { typing: false }]);
    vi.useRealTimers();
  });
});
