import { describe, expect, it } from 'vitest';
import { BUILTIN_CAPABILITIES, validateManifest, type AppManifest } from '@seanhogg/builderforce-webcontainers-core/manifest';
import { AGENT_CRON_DEFAULT_TIMEZONE, toAgentDeclaration, type AgentDraft } from './agentDeclarationDraft';

const draft = (patch: Partial<AgentDraft> = {}): AgentDraft => ({
  id: 'triage',
  role: { kind: 'role', key: 'developer' },
  instructionsPath: '',
  tools: [],
  triggers: [],
  budget: {},
  ...patch,
});

const manifestWith = (id: string, agent: ReturnType<typeof toAgentDeclaration>): AppManifest => ({
  version: 1,
  services: { web: { runtime: 'node', command: 'node server.js', port: 3000 } },
  capabilities: { agents: {} },
  agents: { [id]: agent },
} as AppManifest);

describe('toAgentDeclaration', () => {
  it('maps an empty tool list to a valid declaration', () => {
    const declaration = toAgentDeclaration(draft());
    expect(declaration).toEqual({ role: 'developer', tools: [] });
    expect(validateManifest(manifestWith('triage', declaration), { capabilities: BUILTIN_CAPABILITIES })).toEqual([]);
  });

  it('gives a cron without a timezone UTC, and keeps a named zone', () => {
    const declaration = toAgentDeclaration(draft({
      triggers: [{ kind: 'cron', cron: '0 3 * * *' }, { kind: 'cron', cron: '0 9 * * 1', timezone: 'Europe/Paris' }, { kind: 'manual' }],
    }));
    expect(declaration.triggers).toEqual([
      { cron: '0 3 * * *', timezone: AGENT_CRON_DEFAULT_TIMEZONE },
      { cron: '0 9 * * 1', timezone: 'Europe/Paris' },
      { manual: true },
    ]);
  });

  it('declares a workload instead of a role, and drops an empty budget and instructions', () => {
    const declaration = toAgentDeclaration(draft({ role: { kind: 'workload', key: 'research' }, budget: { steps: 20, usd: undefined } }));
    expect(declaration).toEqual({ workload: 'research', tools: [], budget: { steps: 20 } });
  });
});
