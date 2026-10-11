import { describe, expect, it, vi } from 'vitest';
import { isMidTurnMetadata } from '@builderforce/agent-loop';
import { lineageMetadata, lineagePersistence, parseSubagentOrigin, type RunLineage } from './runLineage';
import { parseMessageAuthor } from './directedMessage';
import type { BrainMessage } from './types';

/**
 * A sub-agent is an ordinary run with an owner pointer. What the pointer must guarantee:
 * every message the child persists lands in its owner's chat as the CHILD — never in the
 * owner's voice — names whose sub-agent it is, and is progress, not the chat's answer.
 */
const lineage: RunLineage = {
  rootChatId: 42,
  ownerKey: 42,
  ownerName: 'BuilderForce',
  handle: 'a2',
  label: 'port the auth middleware',
  agent: { ref: 'agent_ada', name: 'Ada' },
  depth: 1,
};

describe('lineageMetadata', () => {
  it('attributes the message to the child and names its owner', () => {
    const meta = lineageMetadata(lineage);
    expect(parseMessageAuthor({ metadata: meta })).toEqual({ kind: 'agent', ref: 'agent_ada', name: 'Ada' });
    expect(parseSubagentOrigin({ metadata: meta })).toEqual({ handle: 'a2', owner: 'BuilderForce', label: 'port the auth middleware' });
  });

  it('marks it mid-turn, so Evermind never learns a child report as the chat answer', () => {
    expect(isMidTurnMetadata(lineageMetadata(lineage))).toBe(true);
  });

  it('keeps every key the message already carried', () => {
    const meta = JSON.parse(lineageMetadata(lineage, JSON.stringify({ model: 'm1' }))) as Record<string, unknown>;
    expect(meta.model).toBe('m1');
  });

  it('reads nothing from an ordinary message', () => {
    expect(parseSubagentOrigin({ metadata: JSON.stringify({ model: 'm1' }) })).toBeNull();
    expect(parseSubagentOrigin({ metadata: null })).toBeNull();
  });
});

describe('lineagePersistence', () => {
  it('writes through the owner persistence, attributed, and splices conversation into the live view', async () => {
    const sent: Array<{ chatId: number; metadata?: string }> = [];
    const base = {
      sendMessages: vi.fn(async (chatId: number, messages: Array<{ role: string; content: string; metadata?: string }>) => {
        for (const m of messages) sent.push({ chatId, ...(m.metadata ? { metadata: m.metadata } : {}) });
        return messages.map((m, i) => ({ id: i + 1, role: m.role, content: m.content, metadata: m.metadata ?? null }) as unknown as BrainMessage);
      }),
    };
    const spliced: BrainMessage[] = [];
    const p = lineagePersistence(base, lineage, (m) => spliced.push(m));
    await p.sendMessages(42, [
      { role: 'assistant', content: 'done' },
      { role: 'tool', content: '', metadata: JSON.stringify({ step: 1 }) },
    ]);
    expect(sent.every((m) => parseSubagentOrigin(m)?.handle === 'a2')).toBe(true);
    // Trace rows are persisted, but only conversation joins the owner's live view.
    expect(spliced.map((m) => m.role)).toEqual(['assistant']);
  });
});
