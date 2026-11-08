import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import { AGENT_KIND_PILL, type AgentKind } from './agentKindPill';

const kinds: AgentKind[] = ['host', 'cloud', 'vscode'];
const labels = en.observability.agentKind as Record<AgentKind, string>;

describe('AGENT_KIND_PILL', () => {
  it('maps each kind to its own localized label key', () => {
    expect(new Set(kinds.map((k) => AGENT_KIND_PILL[k].labelKey)).size).toBe(kinds.length);
    for (const k of kinds) expect(AGENT_KIND_PILL[k].labelKey).toBe(`agentKind.${k}`);
  });

  it('a CLOUD run never renders as ON-PREM', () => {
    expect(labels[AGENT_KIND_PILL.cloud.labelKey.split('.')[1] as AgentKind]).toBe('CLOUD');
    expect(labels.host).toBe('ON-PREM');
    expect(AGENT_KIND_PILL.cloud.labelKey).not.toBe(AGENT_KIND_PILL.host.labelKey);
  });

  it('uses theme tokens only', () => {
    for (const k of kinds) {
      expect(AGENT_KIND_PILL[k].bg).toMatch(/^var\(--/);
      expect(AGENT_KIND_PILL[k].color).toMatch(/^var\(--/);
    }
  });
});
