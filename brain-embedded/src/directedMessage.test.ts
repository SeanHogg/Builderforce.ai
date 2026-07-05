import { describe, it, expect } from 'vitest';
import {
  withDirectedMetadata,
  parseDirectedRecipient,
  isDirectedToParticipant,
  mentionRecipient,
  resolveRecipient,
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
