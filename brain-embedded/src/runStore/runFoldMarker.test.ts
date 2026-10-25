import { describe, expect, it } from 'vitest';
import { consolidationMarkerOf } from '@seanhogg/builderforce-memory/working';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { BrainMessage } from '../types';
import { makeCell } from './runCell';
import { persistFoldMarker, recordTranscriptAnchors } from './runFoldMarker';
import type { BrainRunPersistence } from './runTypes';

const user = (content: string): ChatCompletionMessage => ({ role: 'user', content });
const reply = (content: string): ChatCompletionMessage => ({ role: 'assistant', content });

/** A persistence port that records the marker it was asked to save. */
function recording() {
  const saved: Array<{ role: string; content: string; metadata?: string }> = [];
  const port: BrainRunPersistence = {
    async sendMessages(_chatId, messages) {
      saved.push(...messages);
      return messages.map((m, i) => ({ id: 900 + i, seq: 900 + i, role: m.role, content: m.content, metadata: m.metadata ?? null, createdAt: new Date().toISOString() }) as BrainMessage);
    },
  };
  return { saved, port, keepFromId: () => consolidationMarkerOf({ metadata: saved[0]?.metadata ?? null })?.keepFromId };
}

const fold = (coveredEnd: number) => ({ droppedMessages: coveredEnd, note: 'note', coveredEnd });

describe('a persisted fold keeps every message its note did not hold', () => {
  it('anchors a transcript seeded from THIS request by identity, and keeps from the cut', async () => {
    const c = makeCell();
    const seed = [user('a'), reply('b'), user('c')];
    c.transcript = [...seed, reply('d'), user('e')];
    recordTranscriptAnchors(c, { seed, seedIds: [1, 2, 3], userTurn: 'e', userTurnMessageId: 5 });
    const rec = recording();
    await persistFoldMarker(c, 1, rec.port, fold(2));
    expect(rec.keepFromId()).toBe(3);
  });

  it('clamps to a message persisted between runs that the cell never saw (an @agent reply)', async () => {
    const c = makeCell();
    // Run 1 seeded the cell; run 1's own turn and reply are in its transcript.
    c.transcript = [user('a'), reply('b'), user('run 1'), reply('run 1 answer')];
    c.transcriptAnchors = [{ index: 0, id: 1 }, { index: 1, id: 2 }, { index: 2, id: 3 }];
    // Run 2's history: everything persisted so far, including an @agent reply (id 5)
    // this cell never held, then run 2's user turn.
    const seed = [user('a'), reply('b'), user('run 1'), reply('run 1 answer'), reply('agent reply')];
    c.transcript.push(user('run 2'));
    recordTranscriptAnchors(c, { seed, seedIds: [1, 2, 3, 4, 5], userTurn: 'run 2', userTurnMessageId: 6 });
    expect(c.unseenFromId).toBe(5);
    const rec = recording();
    // The fold covers past run 2's user turn: without the clamp it would keep from 6.
    await persistFoldMarker(c, 1, rec.port, fold(6));
    expect(rec.keepFromId()).toBe(5);
  });

  it('anchors matched history it can now place, so an exact cut needs no clamp', () => {
    const c = makeCell();
    c.transcript = [user('a'), reply('<think>x</think>b'), user('run 2')];
    recordTranscriptAnchors(c, { seed: [user('a'), reply('b')], seedIds: [1, 2], userTurn: 'run 2', userTurnMessageId: 3 });
    expect(c.unseenFromId).toBeUndefined();
    expect(c.transcriptAnchors).toEqual(expect.arrayContaining([{ index: 0, id: 1 }, { index: 1, id: 2 }, { index: 2, id: 3 }]));
  });

  it('skips the marker when no persisted message precedes the cut', async () => {
    const c = makeCell();
    c.transcript = [user('a')];
    const rec = recording();
    await persistFoldMarker(c, 1, rec.port, fold(1));
    expect(rec.saved).toEqual([]);
  });
});
