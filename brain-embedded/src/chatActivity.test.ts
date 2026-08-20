import { describe, it, expect } from 'vitest';
import {
  parseChatActivity,
  isActivityMessage,
  chatActivityText,
  activityTone,
  DEFAULT_CHAT_ACTIVITY_LABELS,
} from './chatActivity';

/**
 * The point of this contract is that a run milestone is DATA, so both chat surfaces can
 * word it themselves. These tests pin the two halves that make that true: the metadata
 * parses into facts, and the sentence is composed from a template rather than shipped.
 */
describe('parseChatActivity', () => {
  it('reads a completed milestone as structured facts', () => {
    const activity = parseChatActivity({
      metadata: JSON.stringify({
        runMilestone: '77:completed', phase: 'completed', ticketKind: 'task', ticketRef: '41',
        executionId: 77, agentName: 'Ada', toStatus: 'in review', note: 'All tests pass.',
      }),
    });
    expect(activity).toEqual({
      kind: 'milestone', phase: 'completed', agentName: 'Ada', ticketKind: 'task',
      ticketRef: '41', executionId: 77, toStatus: 'in review', note: 'All tests pass.',
    });
  });

  it('reads an agent dispatch', () => {
    const activity = parseChatActivity({
      metadata: JSON.stringify({ agentDispatch: true, agentName: 'Ada', ticketKind: 'epic', ticketRef: '9' }),
    });
    expect(activity).toEqual({ kind: 'dispatch', agentName: 'Ada', ticketKind: 'epic', ticketRef: '9' });
  });

  it('falls back to the agent ref on a row written before agentName existed', () => {
    const activity = parseChatActivity({
      metadata: JSON.stringify({ runMilestone: '1:started', phase: 'started', agentRef: 'agent-7', ticketRef: '3' }),
    });
    expect(activity?.agentName).toBe('agent-7');
  });

  it('is null for an ordinary assistant turn, a malformed blob, and no metadata', () => {
    expect(parseChatActivity({ metadata: JSON.stringify({ provenance: { model: 'x' } }) })).toBeNull();
    expect(parseChatActivity({ metadata: '{not json' })).toBeNull();
    expect(parseChatActivity({ metadata: null })).toBeNull();
    expect(isActivityMessage({ metadata: null })).toBe(false);
  });

  it('refuses a milestone whose phase is not one we render', () => {
    expect(parseChatActivity({ metadata: JSON.stringify({ runMilestone: 'k', phase: 'exploded' }) })).toBeNull();
  });
});

describe('chatActivityText', () => {
  const labels = { ...DEFAULT_CHAT_ACTIVITY_LABELS, milestoneCompletedWithLane: '{agent}::{kind}::{ref}::{lane}' };

  it('composes from the caller’s templates, not from a server sentence', () => {
    const activity = parseChatActivity({
      metadata: JSON.stringify({
        runMilestone: 'k', phase: 'completed', ticketKind: 'task', ticketRef: '41',
        agentName: 'Ada', toStatus: 'in review',
      }),
    })!;
    expect(chatActivityText(activity, labels)).toBe('Ada::task::41::in review');
  });

  it('uses the lane-less template when the run moved nothing', () => {
    const activity = parseChatActivity({
      metadata: JSON.stringify({ runMilestone: 'k', phase: 'completed', ticketRef: '41', agentName: 'Ada' }),
    })!;
    expect(chatActivityText(activity, labels)).toBe('Ada finished task #41');
  });

  it('tones a failure differently from a completion', () => {
    const fail = parseChatActivity({ metadata: JSON.stringify({ runMilestone: 'k', phase: 'failed', ticketRef: '1' }) })!;
    const done = parseChatActivity({ metadata: JSON.stringify({ runMilestone: 'k', phase: 'completed', ticketRef: '1' }) })!;
    expect(activityTone(fail)).toBe('bad');
    expect(activityTone(done)).toBe('good');
  });
});
