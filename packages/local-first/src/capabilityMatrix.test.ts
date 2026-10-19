import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_MATRIX,
  CAPABILITY_NOT_QUEUEABLE,
  CAPABILITY_REQUIRES_CONNECTION,
  CAPABILITY_SURFACES,
  HOST_CAPABILITIES,
  POLICY_CAPABILITY_ROWS,
  QUEUEABLE_CAPABILITIES,
  assertCapabilityAllowed,
  assertQueueable,
  capabilitiesForSurface,
  offlineBehaviour,
  resolveCapability,
  rowForPolicyCapability,
  type CapabilityPolicy,
  type HostCapability,
} from './capabilityMatrix.js';

const PLATFORM_CAPABILITIES: readonly CapabilityPolicy[] = [
  'synchronize',
  'gateway-inference',
  'connected-feature',
  'authenticate',
  'model-download',
  'direct-provider',
  'external-mcp',
  'git-remote',
];

const CONNECTED: readonly HostCapability[] = [
  'meeting',
  'meeting-join',
  'attachment-upload',
  'cloud-mcp-tool',
  'mcp-management',
  'cloud-execution',
  'gateway-inference',
  'oauth-management',
  'connected-feature',
  'remote-creation',
  'approval-decision',
  'model-download',
  'direct-provider',
  'synchronize',
  'git-push',
];

describe('capability matrix', () => {
  it('freezes one row per host capability and nothing else', () => {
    expect(Object.isFrozen(CAPABILITY_MATRIX)).toBe(true);
    expect(Object.isFrozen(QUEUEABLE_CAPABILITIES)).toBe(true);
    expect(Object.keys(CAPABILITY_MATRIX)).toEqual([...HOST_CAPABILITIES]);
    for (const capability of HOST_CAPABILITIES) {
      const row = CAPABILITY_MATRIX[capability];
      expect(Object.isFrozen(row)).toBe(true);
      expect(row.capability).toBe(capability);
      expect(row.behaviour).not.toBe('blocked');
      expect(CAPABILITY_SURFACES).toContain(row.surface);
      expect(row.reason.endsWith('.')).toBe(true);
    }
  });

  it('has at least one row of each offline class', () => {
    expect(offlineBehaviour('local-file-read').behaviour).toBe('local');
    expect(offlineBehaviour('attachment-manifest').behaviour).toBe('local');
    expect(offlineBehaviour('local-message-write').behaviour).toBe('queued');
    expect(offlineBehaviour('meeting').behaviour).toBe('connected-only');
    expect(offlineBehaviour('not-a-capability').behaviour).toBe('blocked');
    const present = new Set(HOST_CAPABILITIES.map((capability) => CAPABILITY_MATRIX[capability].behaviour));
    expect([...present].sort()).toEqual(['connected-only', 'local', 'queued']);
  });

  it('classifies a cloud-only tool as connected-only and refuses it offline', () => {
    const row = offlineBehaviour('cloud-mcp-tool');
    expect(row).toBe(CAPABILITY_MATRIX['cloud-mcp-tool']);
    expect(row.behaviour).toBe('connected-only');
    expect(row.surface).toBe('cloud-tool');
    expect(row.policyCapability).toBe('external-mcp');
    expect(() => resolveCapability('cloud-mcp-tool')).toThrow(expect.objectContaining({
      name: 'CapabilityRefusedError',
      code: CAPABILITY_REQUIRES_CONNECTION,
      capability: 'cloud-mcp-tool',
    }));
    expect(() => assertCapabilityAllowed('cloud-mcp-tool', { platformAllowed: false })).toThrow(
      CAPABILITY_REQUIRES_CONNECTION,
    );
    expect(resolveCapability('cloud-mcp-tool', { platformAllowed: true }).kind).toBe('connected-only');
  });

  it('does not treat an attachment manifest as a live meeting', () => {
    const manifest = offlineBehaviour('attachment-manifest');
    const meeting = offlineBehaviour('meeting');
    expect(manifest.behaviour).toBe('local');
    expect(manifest.surface).toBe('attachment');
    expect(manifest.entityType).toBe('attachment-manifest');
    expect(meeting.behaviour).toBe('connected-only');
    expect(meeting.surface).toBe('meeting');
    expect(manifest.surface).not.toBe(meeting.surface);
    expect(manifest.behaviour).not.toBe(meeting.behaviour);
    expect(capabilitiesForSurface('meeting')).toEqual(['meeting', 'meeting-join']);
    expect(capabilitiesForSurface('meeting')).not.toContain('attachment-manifest');
    expect(resolveCapability('attachment-manifest').kind).toBe('local');
    expect(() => resolveCapability('meeting')).toThrow(expect.objectContaining({ capability: 'meeting' }));
    expect(() => resolveCapability('attachment-manifest')).not.toThrow();
  });

  it('refuses every connected-only capability instead of dropping it', () => {
    for (const capability of CONNECTED) {
      expect(CAPABILITY_MATRIX[capability].behaviour).toBe('connected-only');
      let resolved: unknown = 'not-called';
      expect(() => {
        resolved = resolveCapability(capability, { platformAllowed: false });
      }).toThrow(expect.objectContaining({
        name: 'CapabilityRefusedError',
        code: CAPABILITY_REQUIRES_CONNECTION,
        capability,
      }));
      expect(resolved).toBe('not-called');
      expect(resolveCapability(capability, { platformAllowed: true }).row).toBe(CAPABILITY_MATRIX[capability]);
    }
  });

  it('never enqueues an arbitrary MCP call as offline history', () => {
    expect(() => assertQueueable('cloud-mcp-tool')).toThrow(expect.objectContaining({
      name: 'CapabilityNotQueueableError',
      code: CAPABILITY_NOT_QUEUEABLE,
      capability: 'cloud-mcp-tool',
      behaviour: 'connected-only',
    }));
    expect(() => assertQueueable('mcp-management')).toThrow(CAPABILITY_NOT_QUEUEABLE);
    expect(() => assertQueueable('meeting')).toThrow(CAPABILITY_NOT_QUEUEABLE);
    expect(() => assertQueueable('not-a-capability')).toThrow(expect.objectContaining({
      behaviour: 'blocked',
    }));
    expect(QUEUEABLE_CAPABILITIES).not.toContain('cloud-mcp-tool');
    expect(QUEUEABLE_CAPABILITIES).not.toContain('meeting');
    expect(QUEUEABLE_CAPABILITIES).not.toContain('attachment-manifest');
    for (const capability of QUEUEABLE_CAPABILITIES) {
      expect(CAPABILITY_MATRIX[capability].entityType).not.toBeNull();
    }
    expect(assertQueueable('local-message-write')).toBe('message');
    expect(assertQueueable('local-fact-publish')).toBe('memory-fact');
    expect(assertQueueable('local-audit-finding')).toBe('audit-finding');
  });

  it('classifies every imported platform capability and refuses it offline', () => {
    expect(Object.keys(POLICY_CAPABILITY_ROWS).sort()).toEqual([...PLATFORM_CAPABILITIES].sort());
    for (const capability of PLATFORM_CAPABILITIES) {
      const row = rowForPolicyCapability(capability);
      expect(row.behaviour).toBe('connected-only');
      expect(row.policyCapability).toBe(capability);
      expect(() => resolveCapability(row.capability)).toThrow(CAPABILITY_REQUIRES_CONNECTION);
    }
  });

  it('blocks an unknown capability without throwing from the lookup or substituting a server call', () => {
    const lookup = offlineBehaviour('not-a-capability');
    expect(Object.isFrozen(lookup)).toBe(true);
    expect(lookup.behaviour).toBe('blocked');
    expect(lookup.capability).toBe('not-a-capability');
    expect(lookup.surface).toBeNull();
    expect(lookup.policyCapability).toBeNull();
    expect(lookup.entityType).toBeNull();
    expect(lookup.reason.toLowerCase()).not.toContain('fallback');
    expect(lookup).not.toBeInstanceOf(Promise);
    expect(() => offlineBehaviour('constructor')).not.toThrow();
    expect(offlineBehaviour('constructor').behaviour).toBe('blocked');
    expect(offlineBehaviour('').behaviour).toBe('blocked');
    expect(() => resolveCapability('constructor')).toThrow(expect.objectContaining({
      code: CAPABILITY_REQUIRES_CONNECTION,
      capability: 'constructor',
    }));
  });

  it('keeps cached platform reads local and labelled stale', () => {
    for (const capability of ['server-summary', 'remote-session-read', 'project-panel'] as const) {
      const row = offlineBehaviour(capability);
      expect(row.behaviour).toBe('local');
      expect(row.freshness).toBe('cached-stale');
      expect(row.surface).toBe('remote-data');
      expect(resolveCapability(capability).kind).toBe('local');
    }
  });
});
