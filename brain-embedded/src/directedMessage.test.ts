import { describe, it, expect } from 'vitest';
import {
  withDirectedMetadata,
  parseDirectedRecipient,
  isDirectedToParticipant,
  mentionRecipient,
  resolveRecipient,
  activeMentionToken,
  filterMentionCandidates,
  type DirectedRecipient,
} from './directedMessage';

const bob: DirectedRecipient = { kind: 'agent', ref: '42', name: 'Bob Developer' };
const ada: DirectedRecipient = { kind: 'human', ref: 'u_1', name: 'Ada Lovelace' };

describe('directed message metadata', () => {
  it('round-trips a recipient through metadata', () => {
    const meta = withDirectedMetadata(bob);
    expect(parseDirectedRecipient({ metadata: meta })).toEqual(bob);
    expect(isDirectedToParticipant({ metadata: meta })).toBe(true);
  });

  it('preserves other metadata keys (e.g. attachments)', () => {
    const meta = withDirectedMetadata(bob, { attachments: [{ key: 'a' }] });
    expect(JSON.parse(meta!)).toMatchObject({ addressedTo: bob, attachments: [{ key: 'a' }] });
  });

  it('is undefined when there is nothing to store', () => {
    expect(withDirectedMetadata(null)).toBeUndefined();
    expect(withDirectedMetadata(undefined)).toBeUndefined();
  });

  it('treats a BRAIN turn (no addressedTo) as not directed', () => {
    expect(parseDirectedRecipient({ metadata: null })).toBeNull();
    expect(parseDirectedRecipient({ metadata: JSON.stringify({ attachments: [] }) })).toBeNull();
    expect(isDirectedToParticipant({ metadata: '{bad json' })).toBe(false);
  });
});

describe('mentionRecipient', () => {
  const pool = [bob, ada];
  it('matches a leading @first-name', () => {
    expect(mentionRecipient('@Bob can you review', pool)).toEqual(bob);
    expect(mentionRecipient('  @ada ping', pool)).toEqual(ada);
  });
  it('returns null with no leading mention or no match', () => {
    expect(mentionRecipient('hello world', pool)).toBeNull();
    expect(mentionRecipient('@nobody hi', pool)).toBeNull();
    expect(mentionRecipient('mid @Bob mention', pool)).toBeNull();
  });
});

describe('activeMentionToken', () => {
  it('detects a token being typed at the caret', () => {
    expect(activeMentionToken('@ad', 3)).toEqual({ query: 'ad', start: 0, end: 3 });
    expect(activeMentionToken('hi @bo', 6)).toEqual({ query: 'bo', start: 3, end: 6 });
    expect(activeMentionToken('@', 1)).toEqual({ query: '', start: 0, end: 1 });
  });
  it('only fires at the caret inside the token', () => {
    // caret before the "@" → no token
    expect(activeMentionToken('@bob', 0)).toBeNull();
    // caret past a completed token followed by a space → no live token
    expect(activeMentionToken('@bob ', 5)).toBeNull();
  });
  it('never triggers on an email address (@ mid-word)', () => {
    expect(activeMentionToken('a@b', 3)).toBeNull();
    expect(activeMentionToken('me@host.com', 11)).toBeNull();
  });
});

describe('filterMentionCandidates', () => {
  const pool = [bob, ada];
  it('returns all on an empty query', () => {
    expect(filterMentionCandidates(pool, '')).toEqual(pool);
  });
  it('substring-matches case-insensitively', () => {
    expect(filterMentionCandidates(pool, 'a')).toEqual([ada]); // only "Ada Lovelace" contains 'a'
    expect(filterMentionCandidates(pool, 'bob')).toEqual([bob]);
    expect(filterMentionCandidates(pool, 'lovelace')).toEqual([ada]);
    expect(filterMentionCandidates(pool, 'zzz')).toEqual([]);
  });
  it('ranks a name-start match ahead of a later match', () => {
    const dev: DirectedRecipient = { kind: 'agent', ref: 'd', name: 'Devon' };
    // query 'de': "Devon" starts at 0, "Bob Developer" matches at index 4 → Devon first.
    expect(filterMentionCandidates([bob, dev], 'de')).toEqual([dev, bob]);
  });
});

describe('resolveRecipient', () => {
  it('an explicit BRAIN pick wins over a mention', () => {
    expect(resolveRecipient('brain', bob)).toBeNull();
  });
  it('an explicit participant wins over a mention', () => {
    expect(resolveRecipient(ada, bob)).toEqual(ada);
  });
  it('falls back to the mention, then the BRAIN', () => {
    expect(resolveRecipient(null, bob)).toEqual(bob);
    expect(resolveRecipient(null, null)).toBeNull();
  });
});
