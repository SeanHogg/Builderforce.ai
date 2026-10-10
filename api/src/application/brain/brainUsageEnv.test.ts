import { describe, it, expect } from 'vitest';
import type { Env } from '../../env';
import { hasSiblingDatabase } from '../../infrastructure/database/connection';
import { brainUsageEnv } from './brainUsageEnv';

describe('brainUsageEnv', () => {
  const callEnv = {
    NEON_DATABASE_URL: 'postgres://core.invalid/db',
    NEON_TRANSACTIONAL_DATABASE_URL: 'postgres://operational.invalid/db',
    OPENROUTER_API_KEY: 'platform-key',
  } as unknown as Env;

  it('keeps the transactional binding so the usage row lands on the operational ledger, not core', () => {
    expect(hasSiblingDatabase(brainUsageEnv(callEnv, 'operator-key'), 'operational')).toBe(true);
  });

  it('prices against the call\'s operator key', () => {
    expect(brainUsageEnv(callEnv, 'operator-key').OPENROUTER_API_KEY).toBe('operator-key');
  });

  it('does not mutate the request env', () => {
    brainUsageEnv(callEnv, 'operator-key');
    expect(callEnv.OPENROUTER_API_KEY).toBe('platform-key');
  });
});
