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

describe('a run stopped before it started', () => {
  it('is a stopped turn of its own kind, and never a model reply', async () => {
    const { isStoppedBeforeStart, stoppedBeforeStartRow } = await import('./stoppedTurn');
    const { isModelReply } = await import('./modelReply');
    const row = stoppedBeforeStartRow();
    expect(isStoppedTurn(row)).toBe(true);
    expect(isStoppedBeforeStart(row)).toBe(true);
    expect(isModelReply(row)).toBe(false);
    // A mid-run Stop keeps what the model wrote: still a reply, not a never-started run.
    const midRun = { role: 'assistant', metadata: stoppedTurnMetadata({ model: 'm' }) };
    expect(isStoppedBeforeStart(midRun)).toBe(false);
    expect(isModelReply(midRun)).toBe(true);
  });
});
