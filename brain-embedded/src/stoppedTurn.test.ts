import { describe, it, expect } from 'vitest';
import { isStoppedTurn, stoppedTurnMetadata, STOPPED_TURN_META_KEY } from './stoppedTurn';
import { parseMessageProvenance } from './provenance';

describe('stoppedTurn', () => {
  it('marks the turn and carries the model that was streaming as ordinary provenance', () => {
    const metadata = stoppedTurnMetadata({ model: 'xai-oauth/grok-4.6', account: 'own' });
    expect(isStoppedTurn({ metadata })).toBe(true);
    expect(parseMessageProvenance({ metadata })).toEqual({ model: 'xai-oauth/grok-4.6', account: 'own' });
  });

  it('still marks a turn stopped before the gateway named a model, with no provenance', () => {
    const metadata = stoppedTurnMetadata({});
    expect(isStoppedTurn({ metadata })).toBe(true);
    expect(parseMessageProvenance({ metadata })).toBeNull();
  });

  it('drops an account value the wire contract does not know', () => {
    expect(parseMessageProvenance({ metadata: stoppedTurnMetadata({ model: 'm', account: 'mystery' }) })).toEqual({ model: 'm' });
  });

  it('reads ordinary and malformed metadata as not stopped', () => {
    expect(isStoppedTurn({ metadata: null })).toBe(false);
    expect(isStoppedTurn({ metadata: JSON.stringify({ provenance: { model: 'm' } }) })).toBe(false);
    expect(isStoppedTurn({ metadata: JSON.stringify({ [STOPPED_TURN_META_KEY]: 'yes' }) })).toBe(false);
    expect(isStoppedTurn({ metadata: '{not json' })).toBe(false);
  });
});
