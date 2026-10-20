import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_UNSUPPORTED,
  assertSupported,
  substituteRefused,
  type CapabilitySupport,
} from './capabilitySupport.js';

const SUPPORT: CapabilitySupport = Object.freeze({
  chat: true,
  'local-file-read': true,
  voice_call: false,
});

function expectUnsupported(run: () => unknown, capability: string): void {
  expect(run).toThrow(expect.objectContaining({
    name: 'CapabilityUnsupportedError',
    code: CAPABILITY_UNSUPPORTED,
    capability,
  }));
}

describe('capability support', () => {
  it('accepts a capability the host explicitly supports', () => {
    expect(() => assertSupported('chat', SUPPORT)).not.toThrow();
    expect(() => assertSupported('local-file-read', SUPPORT)).not.toThrow();
  });

  it('refuses a capability the host does not list', () => {
    expectUnsupported(() => assertSupported('meeting', SUPPORT), 'meeting');
  });

  it('refuses a capability the host lists as unsupported', () => {
    expectUnsupported(() => assertSupported('voice_call', SUPPORT), 'voice_call');
  });

  it('refuses an empty capability name rather than matching a truthy prototype key', () => {
    expectUnsupported(() => assertSupported('', { '': true }), '');
    expectUnsupported(() => assertSupported('constructor', SUPPORT), 'constructor');
    expectUnsupported(() => assertSupported('toString', SUPPORT), 'toString');
  });

  it('refuses a substitute instead of returning a different capability', () => {
    let returned: unknown = 'not-called';
    expectUnsupported(() => {
      returned = substituteRefused('voice_call', SUPPORT);
    }, 'voice_call');
    expect(returned).toBe('not-called');
    expect(Object.keys(SUPPORT)).toContain('chat');
  });

  it('refuses a substitute even when the requested capability is supported', () => {
    expectUnsupported(() => substituteRefused('chat', SUPPORT), 'chat');
  });

  it('never names a different capability in the refusal', () => {
    try {
      substituteRefused('voice_call', SUPPORT);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('voice_call');
      expect((error as Error).message).not.toContain('chat');
      expect((error as { code: string }).code).toBe('capability_unsupported');
    }
  });
});
