import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { platformConnectivity, type PlatformConnectivityInput } from './platformDeniedDefault.js';

const KEYS_AND_MODELS: PlatformConnectivityInput = {
  savedGatewayKey: true,
  localModelsEnabled: true,
  gatewayFallback: true,
};

describe('API-denied platform default', () => {
  it('denies the platform and keeps inference and sync local when the API is denied', () => {
    const decision = platformConnectivity({ apiDenied: true, ...KEYS_AND_MODELS });
    expect(decision).toEqual({ platform: 'denied', inference: 'local-only', sync: 'local' });
    expect(decision.platform).toBe('denied');
    expect(decision.inference).toBe('local-only');
    expect(decision.sync).toBe('local');
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('forbids gateway fallback while denied even when a key and local models are enabled', () => {
    for (const input of [
      { apiDenied: true, savedGatewayKey: true, localModelsEnabled: true, gatewayFallback: true },
      { apiDenied: true, savedGatewayKey: true, localModelsEnabled: false, gatewayFallback: true },
      { apiDenied: true, savedGatewayKey: false, localModelsEnabled: true, gatewayFallback: false },
      { apiDenied: true, savedGatewayKey: true },
      { apiDenied: true, localModelsEnabled: true },
      { apiDenied: true },
    ] as const) {
      expect(platformConnectivity(input)).toEqual({
        platform: 'denied',
        inference: 'local-only',
        sync: 'local',
      });
    }
  });

  it('does not treat localModels.enabled or a saved key as permission to use the gateway', () => {
    expect(
      platformConnectivity({
        apiDenied: false,
        savedGatewayKey: true,
        localModelsEnabled: true,
        gatewayFallback: false,
      }),
    ).toEqual({ platform: 'allowed', inference: 'local-only', sync: 'connected' });
    expect(
      platformConnectivity({
        apiDenied: false,
        savedGatewayKey: true,
        localModelsEnabled: true,
      }),
    ).toEqual({ platform: 'allowed', inference: 'local-only', sync: 'connected' });
  });

  it('allows gateway fallback only when the API is not denied and gatewayFallback is true', () => {
    const allowed = platformConnectivity({
      apiDenied: false,
      savedGatewayKey: false,
      localModelsEnabled: false,
      gatewayFallback: true,
    });
    expect(allowed).toEqual({ platform: 'allowed', inference: 'gateway-allowed', sync: 'connected' });
    expect(Object.isFrozen(allowed)).toBe(true);
    expect(
      platformConnectivity({ apiDenied: false, gatewayFallback: true, ...KEYS_AND_MODELS }),
    ).toEqual({ platform: 'allowed', inference: 'gateway-allowed', sync: 'connected' });
  });

  it('denies by default when apiDenied is missing, so local models cannot open the gateway', () => {
    expect(platformConnectivity({})).toEqual({ platform: 'denied', inference: 'local-only', sync: 'local' });
    expect(platformConnectivity({ ...KEYS_AND_MODELS })).toEqual({
      platform: 'denied',
      inference: 'local-only',
      sync: 'local',
    });
    expect(platformConnectivity(undefined)).toEqual({ platform: 'denied', inference: 'local-only', sync: 'local' });
    expect(platformConnectivity(null)).toEqual({ platform: 'denied', inference: 'local-only', sync: 'local' });
    expect(platformConnectivity({ apiDenied: null, ...KEYS_AND_MODELS })).toEqual({
      platform: 'denied',
      inference: 'local-only',
      sync: 'local',
    });
  });

  it('does not read VS Code configuration or import a network client', () => {
    const source = readFileSync(new URL('./platformDeniedDefault.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/vscode/i);
    expect(source).not.toMatch(/getConfiguration/);
    expect(source).not.toMatch(/localModels\.enabled/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net)['"]/);
    const exported = [...source.matchAll(/export function (\w+)/g)].map((match) => match[1]);
    expect(exported).toEqual(['platformConnectivity']);
  });
});
