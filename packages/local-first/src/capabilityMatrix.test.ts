import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_MATRIX,
  OFFLINE_BEHAVIOURS,
  PLATFORM_CAPABILITIES,
  offlineBehaviour,
  type OfflineBehaviour,
} from './capabilityMatrix.js';

const MEETINGS = ['meeting', 'meeting-join'] as const;
const ATTACHMENTS = ['attachment-manifest', 'attachment-blob', 'attachment-upload'] as const;
const CLOUD_ONLY_TOOLS = [
  'cloud-mcp-tool',
  'mcp-management',
  'cloud-execution',
  'oauth-management',
  'remote-creation',
  'remote-session-read',
  'approval-decision',
] as const;

const EXPECTED: Readonly<Record<string, OfflineBehaviour>> = {
  meeting: 'queue',
  'meeting-join': 'queue',
  'attachment-manifest': 'local',
  'attachment-blob': 'local',
  'attachment-upload': 'queue',
  'server-summary': 'local',
  'project-panel': 'local',
  'cloud-mcp-tool': 'cloud-only',
  'mcp-management': 'cloud-only',
  'cloud-execution': 'cloud-only',
  'oauth-management': 'cloud-only',
  'remote-creation': 'cloud-only',
  'remote-session-read': 'cloud-only',
  'approval-decision': 'cloud-only',
  synchronize: 'cloud-only',
  'gateway-inference': 'cloud-only',
  'connected-feature': 'cloud-only',
  authenticate: 'cloud-only',
  'model-download': 'cloud-only',
  'direct-provider': 'cloud-only',
  'external-mcp': 'cloud-only',
  'git-remote': 'cloud-only',
};

function platformCapabilitiesInPolicy(): string[] {
  const source = readFileSync(new URL('./policy.ts', import.meta.url), 'utf8');
  const block = source.match(/export type PlatformCapability =([\s\S]*?);/);
  if (!block) throw new Error('PlatformCapability union missing from policy.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('capability matrix', () => {
  it('locks one behaviour per offline-relevant capability', () => {
    expect(Object.isFrozen(CAPABILITY_MATRIX)).toBe(true);
    expect(Object.getPrototypeOf(CAPABILITY_MATRIX)).toBeNull();
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [capability, behaviour] of Object.entries(EXPECTED)) {
      expect(OFFLINE_BEHAVIOURS).toContain(behaviour);
      expect(CAPABILITY_MATRIX[capability]).toBe(behaviour);
      expect(offlineBehaviour(capability)).toBe(behaviour);
    }
  });

  it('keeps meetings and attachments queue or local, never a silent cloud call', () => {
    for (const capability of [...MEETINGS, ...ATTACHMENTS]) {
      const behaviour = offlineBehaviour(capability);
      expect(behaviour === 'queue' || behaviour === 'local').toBe(true);
      expect(behaviour).not.toBe('cloud-only');
      expect(behaviour).not.toBe('denied');
    }
    expect(offlineBehaviour('attachment-manifest')).toBe('local');
    expect(offlineBehaviour('attachment-blob')).toBe('local');
    expect(offlineBehaviour('attachment-upload')).toBe('queue');
    expect(offlineBehaviour('meeting')).toBe('queue');
    expect(offlineBehaviour('meeting-join')).toBe('queue');
  });

  it('does not treat a cloud-only tool as local or available offline', () => {
    for (const capability of CLOUD_ONLY_TOOLS) {
      expect(offlineBehaviour(capability)).toBe('cloud-only');
      expect(offlineBehaviour(capability)).not.toBe('local');
      expect(offlineBehaviour(capability)).not.toBe('queue');
      expect(CAPABILITY_MATRIX[capability]).toBe('cloud-only');
    }
    const source = readFileSync(new URL('./capabilityMatrix.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/cloud-only tool is available offline/i);
    expect(source).toMatch(/not available offline/);
  });

  it('classifies every platform capability from policy.ts as cloud-only', () => {
    const named = platformCapabilitiesInPolicy();
    expect(named).toEqual([...PLATFORM_CAPABILITIES]);
    expect(named).toHaveLength(8);
    for (const capability of named) {
      expect(offlineBehaviour(capability)).toBe('cloud-only');
      expect(offlineBehaviour(capability)).not.toBe('local');
    }
  });

  it('defaults an unknown name to denied and never throws', () => {
    const unknown = ['not-a-capability', '', 'constructor', '__proto__', 'toString', 'Meeting', 'fetch'];
    for (const capability of unknown) {
      expect(() => offlineBehaviour(capability)).not.toThrow();
      expect(offlineBehaviour(capability)).toBe('denied');
    }
    expect(offlineBehaviour(undefined as unknown as string)).toBe('denied');
    expect(offlineBehaviour(null as unknown as string)).toBe('denied');
  });

  it('does not import a network client', () => {
    const source = readFileSync(new URL('./capabilityMatrix.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/^import\s+/m);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net)['"]/);
  });
});
