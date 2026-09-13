import { describe, it, expect } from 'vitest';
import { priorResearchDigest } from './priorResearch';
import type { BrainMessage } from './types';

let nextId = 1;
function step(category: string, label: string, args: unknown, result: unknown, isError = false): BrainMessage {
  const id = nextId++;
  return {
    id, seq: id, role: 'tool', content: '', createdAt: '',
    metadata: JSON.stringify({ kind: 'step', category, label, args, result, isError }),
  };
}
function said(role: 'user' | 'assistant', content: string): BrainMessage {
  const id = nextId++;
  return { id, seq: id, role, content, metadata: null, createdAt: '' };
}

describe('priorResearchDigest', () => {
  it('is null for a chat with no tool steps', () => {
    expect(priorResearchDigest([said('user', 'hi'), said('assistant', 'hello')])).toBeNull();
  });

  it('lists earlier tool calls newest first, with their results', () => {
    const digest = priorResearchDigest([
      said('user', 'add a click to the bubble'),
      step('tool', 'read_file', { path: 'world3d/PeerSpeechBubble.tsx' }, { ok: true, content: 'pointerEvents="none"' }),
      step('tool', 'search_code', { query: 'RoomScene' }, { total: 10 }),
      said('assistant', "I'll start by checking the room bubble."),
    ])!;
    expect(digest).toContain('## Already done earlier in this chat');
    expect(digest.indexOf('search_code')).toBeLessThan(digest.indexOf('read_file'));
    expect(digest).toContain('world3d/PeerSpeechBubble.tsx');
    expect(digest).toContain('pointerEvents');
  });

  it('lists a repeated call once, with its newest result', () => {
    const digest = priorResearchDigest([
      step('tool', 'search_code', { query: 'bubble', path: 'frontend/src' }, 'OLD RESULT'),
      step('tool', 'search_code', { path: 'frontend/src', query: 'bubble' }, 'NEW RESULT'),
    ])!;
    expect(digest.match(/search_code/g)).toHaveLength(1);
    expect(digest).toContain('NEW RESULT');
    expect(digest).not.toContain('OLD RESULT');
  });

  it('marks a failed call so it is not simply retried', () => {
    expect(priorResearchDigest([step('tool', 'git_status', {}, 'not a git repository', true)])).toContain('— FAILED');
  });

  it('skips steps that are not tool calls', () => {
    expect(priorResearchDigest([step('llm', 'llm.complete', { model: 'x' }, 'turn'), step('recall', 'evermind.recall', {}, {})])).toBeNull();
  });

  it('stays bounded however much the chat read', () => {
    const history = Array.from({ length: 120 }, (_, i) => step('tool', 'read_file', { path: `f${i}.ts` }, 'x'.repeat(4_000)));
    const digest = priorResearchDigest(history)!;
    expect(digest.length).toBeLessThanOrEqual(12_000);
    expect(digest).toContain('f119.ts');
  });
});
