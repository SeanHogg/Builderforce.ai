/**
 * A client-supplied dashboard intent key (PRD 42 Part D) is accepted ONLY when it is one
 * of the whitelisted keys; otherwise it is ignored and the server refiner runs.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseClientResult } from '../llm/clientResult';
import { CLIENT_INTENT_SPEC, clientIntentRefiner } from './clientIntentRefiner';

const provenance = { engine: 'browser' as const, model: 'gemini-nano' };
const KEYS = ['tickets.open', 'topic.health'];

describe('CLIENT_INTENT_SPEC', () => {
  it('takes a key string or { key }, nothing else', () => {
    expect(parseClientResult({ json: 'tickets.open', provenance }, CLIENT_INTENT_SPEC).ok).toBe(true);
    expect(parseClientResult({ json: { key: 'tickets.open' }, provenance }, CLIENT_INTENT_SPEC).ok).toBe(true);
    expect(parseClientResult({ json: 42, provenance }, CLIENT_INTENT_SPEC).ok).toBe(false);
    expect(parseClientResult({ json: '', provenance }, CLIENT_INTENT_SPEC).ok).toBe(false);
    expect(parseClientResult({ json: 'x'.repeat(201), provenance }, CLIENT_INTENT_SPEC).ok).toBe(false);
  });
});

describe('clientIntentRefiner', () => {
  it('uses an allowed client key without running the server refiner, and reports it accepted', async () => {
    const server = vi.fn(async () => 'topic.health');
    const accepted = vi.fn();
    const refine = clientIntentRefiner({ value: 'tickets.open', provenance }, server, accepted);
    expect(await refine('how many open', KEYS)).toBe('tickets.open');
    expect(server).not.toHaveBeenCalled();
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it('ignores a key outside the whitelist and runs the server refiner', async () => {
    const server = vi.fn(async () => 'topic.health');
    const accepted = vi.fn();
    const refine = clientIntentRefiner({ value: { key: 'drop.table' }, provenance }, server, accepted);
    expect(await refine('q', KEYS)).toBe('topic.health');
    expect(server).toHaveBeenCalledWith('q', KEYS);
    expect(accepted).not.toHaveBeenCalled();
  });

  it('declines (null) when the key is not allowed and there is no server refiner', async () => {
    expect(await clientIntentRefiner({ value: 'nope', provenance }, undefined)('q', KEYS)).toBeNull();
  });
});
