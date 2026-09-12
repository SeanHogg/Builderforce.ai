import { describe, expect, it } from 'vitest';
import { pickCloudModel } from './LlmProxyService';

/**
 * `pickCloudModel` picks for cloud runs, and a cloud run is always a coding turn, so an
 * `evermind/<ref>` pin must pass the Evermind coding gate (≥ 90% of the frontier
 * baseline on the coding eval, for that head version) before it can be honoured. A
 * closed gate is a silent fallback to the normal coding selection — never an error.
 */
const PIN = 'evermind/evermind/project/7/42/v3';

describe('pickCloudModel — Evermind coding gate', () => {
  it('ignores an Evermind pin that carries no gate verdict', () => {
    const pick = pickCloudModel(PIN, 'pro', false, { isSuperadmin: true });
    expect(pick.model).not.toBe(PIN);
    expect(pick.strict).toBe(false);
  });

  it('ignores it when the verdict is closed, or vouches for a different model', () => {
    expect(pickCloudModel(PIN, 'pro', false, { isSuperadmin: true, evermindCoding: { model: PIN, qualified: false } }).model).not.toBe(PIN);
    expect(pickCloudModel(PIN, 'pro', false, {
      isSuperadmin: true, evermindCoding: { model: 'evermind/evermind/project/7/42/v2', qualified: true },
    }).model).not.toBe(PIN);
  });

  it('leaves every non-Evermind pin exactly as before', () => {
    expect(pickCloudModel('openai/gpt-4.1', 'pro')).toEqual({ model: 'openai/gpt-4.1', strict: true });
    expect(pickCloudModel('openai/gpt-4.1', 'pro', false, { evermindCoding: { model: PIN, qualified: false } }))
      .toEqual({ model: 'openai/gpt-4.1', strict: true });
  });
});
