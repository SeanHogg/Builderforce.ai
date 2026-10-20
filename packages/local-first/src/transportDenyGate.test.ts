import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_TRANSPORT_DENIED,
  PLATFORM_TRANSPORT_KINDS,
  assertPlatformTransport,
  type PlatformTransportKind,
} from './transportDenyGate.js';

const CUSTOM_BASE = 'https://gateway.internal.example/bf/v1/tasks';
const REDIRECT_URL = 'https://collector.example/capture?from=https://api.builderforce.ai/v1/chats';

function thrown(run: () => void): { message?: string; code?: string; kind?: string; url?: string } | undefined {
  try {
    run();
  } catch (error) {
    return error as { message?: string; code?: string; kind?: string; url?: string };
  }
  return undefined;
}

describe('platform transport deny gate', () => {
  it('refuses every transport kind when the API is denied', () => {
    expect([...PLATFORM_TRANSPORT_KINDS]).toEqual(['http', 'stream', 'socket', 'frame']);
    for (const kind of PLATFORM_TRANSPORT_KINDS) {
      const url = `https://api.builderforce.ai/${kind}`;
      const error = thrown(() => assertPlatformTransport({ apiDenied: true, kind, url }));
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe(PLATFORM_TRANSPORT_DENIED);
      expect(error?.code).toBe(PLATFORM_TRANSPORT_DENIED);
      expect(error?.kind).toBe(kind);
      expect(error?.url).toBe(url);
    }
  });

  it('refuses a custom base URL for every kind when the API is denied', () => {
    for (const kind of PLATFORM_TRANSPORT_KINDS) {
      const error = thrown(() => assertPlatformTransport({ apiDenied: true, kind, url: CUSTOM_BASE }));
      expect(error?.code).toBe(PLATFORM_TRANSPORT_DENIED);
      expect(error?.message).toBe(PLATFORM_TRANSPORT_DENIED);
      expect(error?.url).toBe(CUSTOM_BASE);
      expect(error?.kind).toBe(kind);
    }
  });

  it('refuses a redirect URL for every kind when the API is denied', () => {
    for (const kind of PLATFORM_TRANSPORT_KINDS) {
      const error = thrown(() => assertPlatformTransport({ apiDenied: true, kind, url: REDIRECT_URL }));
      expect(error).toBeInstanceOf(Error);
      expect(error?.code).toBe(PLATFORM_TRANSPORT_DENIED);
      expect(error?.message).toBe(PLATFORM_TRANSPORT_DENIED);
      expect(error?.kind).toBe(kind);
      expect(error?.url).toBe(REDIRECT_URL);
    }
  });

  it('allows every kind, a custom base, and a redirect when the API is not denied', () => {
    const urls = ['https://api.builderforce.ai/v1', CUSTOM_BASE, REDIRECT_URL];
    for (const kind of PLATFORM_TRANSPORT_KINDS) {
      for (const url of urls) {
        const result = assertPlatformTransport({ apiDenied: false, kind, url });
        expect(result).toEqual({ ok: true });
        expect(result.ok).toBe(true);
        expect(Object.isFrozen(result)).toBe(true);
      }
    }
  });

  it('does not fetch and exports only the transport assert', () => {
    const source = readFileSync(new URL('./transportDenyGate.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/import\s+[^;]*\bfetch\b/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net|ws)['"]/);
    expect(source).not.toMatch(/\bWebSocket\b/);
    const exported = [...source.matchAll(/export function (\w+)/g)].map((match) => match[1]);
    expect(exported).toEqual(['assertPlatformTransport']);
    const kinds: readonly PlatformTransportKind[] = PLATFORM_TRANSPORT_KINDS;
    expect(kinds).toHaveLength(4);
  });
});
