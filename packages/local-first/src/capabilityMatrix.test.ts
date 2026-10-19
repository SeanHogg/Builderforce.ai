import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_MATRIX,
  HOST_CAPABILITIES,
  offlineBehaviour,
  type HostCapability,
  type OfflineBehaviour,
} from './capabilityMatrix.js';

const CONNECTED_OR_BLOCKED: readonly HostCapability[] = [
  'meeting',
  'attachment-upload',
  'cloud-mcp-tool',
  'gateway-inference',
  'git-push',
];

const LOCAL: readonly HostCapability[] = [
  'local-file-read',
  'local-file-write',
  'local-audit',
  'attachment-manifest',
];

const ALLOWED: readonly OfflineBehaviour[] = ['local', 'blocked', 'connected-only'];
const FORBIDDEN = ['fallback', 'server-substitute'] as const;

describe('capability matrix', () => {
  it('freezes the table and every row', () => {
    expect(Object.isFrozen(CAPABILITY_MATRIX)).toBe(true);
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual([...HOST_CAPABILITIES].sort());
    for (const capability of HOST_CAPABILITIES) {
      const row = CAPABILITY_MATRIX[capability];
      expect(Object.isFrozen(row)).toBe(true);
      expect(row.capability).toBe(capability);
      expect(row.reason.endsWith('.')).toBe(true);
      expect(row.reason.slice(0, -1)).not.toContain('.');
    }
  });

  it('classifies meetings, uploads, cloud tools, gateway inference, and git push as not local', () => {
    for (const capability of CONNECTED_OR_BLOCKED) {
      const row = offlineBehaviour(capability);
      expect(row).toBe(CAPABILITY_MATRIX[capability]);
      expect(['connected-only', 'blocked']).toContain(row.behaviour);
      expect(row.behaviour).not.toBe('local');
    }
    expect(offlineBehaviour('meeting').behaviour).toBe('connected-only');
    expect(offlineBehaviour('attachment-upload').behaviour).toBe('connected-only');
    expect(offlineBehaviour('cloud-mcp-tool').behaviour).toBe('connected-only');
    expect(offlineBehaviour('gateway-inference').behaviour).toBe('connected-only');
    expect(offlineBehaviour('git-push').behaviour).toBe('connected-only');
  });

  it('classifies local files, local audit, and the attachment manifest as local', () => {
    for (const capability of LOCAL) {
      const row = offlineBehaviour(capability);
      expect(row).toBe(CAPABILITY_MATRIX[capability]);
      expect(row.behaviour).toBe('local');
    }
  });

  it('has no fallback or server-substitute behaviour', () => {
    for (const row of Object.values(CAPABILITY_MATRIX)) {
      expect(ALLOWED).toContain(row.behaviour);
      expect(FORBIDDEN).not.toContain(row.behaviour as (typeof FORBIDDEN)[number]);
    }
  });

  it('blocks an unknown capability without throwing or substituting a server call', () => {
    const lookup = offlineBehaviour('not-a-capability');
    expect(lookup.behaviour).toBe('blocked');
    expect(lookup.capability).toBe('not-a-capability');
    expect(lookup.reason.endsWith('.')).toBe(true);
    expect(lookup.reason.toLowerCase()).not.toContain('fallback');
    expect(lookup).not.toBeInstanceOf(Promise);
    expect(() => offlineBehaviour('constructor')).not.toThrow();
    expect(offlineBehaviour('constructor').behaviour).toBe('blocked');
    expect(offlineBehaviour('').behaviour).toBe('blocked');
  });
});
