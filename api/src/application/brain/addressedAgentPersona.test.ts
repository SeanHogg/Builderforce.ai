import { describe, expect, it, vi } from 'vitest';

vi.mock('../agent/agentPrompt', () => ({
  WORKFORCE_MODEL_REF_PREFIX: 'builderforce/workforce-',
  resolveWorkforceModel: vi.fn(async (_env: unknown, _tenantId: number, ref: string, query?: string) =>
    ref === 'builderforce/workforce-42'
      ? { baseModel: 'anthropic/claude', directives: `You are Bob.${query ? ` [recalled for: ${query}]` : ''}`, inferenceMode: 'base', execParams: {} }
      : null,
  ),
}));

import { resolveAddressedAgentPersona } from './addressedAgentPersona';
import { resolveWorkforceModel } from '../agent/agentPrompt';

describe('resolveAddressedAgentPersona', () => {
  it('hands a host the SAME persona lowering the server-side reply runs under', async () => {
    const persona = await resolveAddressedAgentPersona({} as never, 1, '42', 'commit and push to main');
    expect(persona).toEqual({ directives: 'You are Bob. [recalled for: commit and push to main]', model: 'anthropic/claude' });
    expect(vi.mocked(resolveWorkforceModel)).toHaveBeenCalledWith({}, 1, 'builderforce/workforce-42', 'commit and push to main');
  });

  it('is null for an unknown agent or an empty ref, never a throw', async () => {
    expect(await resolveAddressedAgentPersona({} as never, 1, '999')).toBeNull();
    expect(await resolveAddressedAgentPersona({} as never, 1, '   ')).toBeNull();
  });
});
