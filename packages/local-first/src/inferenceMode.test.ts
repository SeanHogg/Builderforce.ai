import { describe, expect, it } from 'vitest';
import {
  INFERENCE_MODES,
  LOCAL_FIRST_POLICY,
  createPlatformPolicy,
  defaultInferenceMode,
  isInferenceMode,
  policyForInferenceMode,
  resolveInferencePolicy,
} from './index.js';

describe('inference mode', () => {
  it('defaults to Hybrid signed in and Local only signed out', () => {
    expect(defaultInferenceMode({ signedIn: true })).toBe('hybrid');
    expect(defaultInferenceMode({ signedIn: false })).toBe('local-only');
  });

  it('lists every mode once, Hybrid first', () => {
    expect(INFERENCE_MODES).toEqual(['hybrid', 'local-only', 'specific']);
    expect(INFERENCE_MODES.every(isInferenceMode)).toBe(true);
    expect(isInferenceMode('cloud')).toBe(false);
    expect(isInferenceMode(undefined)).toBe(false);
  });

  it('derives each mode\'s capability patch', () => {
    expect(policyForInferenceMode('local-only')).toEqual({
      gatewayInference: false, connectedFeatures: false, synchronize: false, directProviders: false,
    });
    expect(policyForInferenceMode('hybrid')).toEqual({
      gatewayInference: true, connectedFeatures: true, synchronize: true, directProviders: false,
    });
    expect(policyForInferenceMode('specific')).toEqual({
      gatewayInference: true, connectedFeatures: true, synchronize: true, directProviders: true,
    });
  });

  it('regression: connected modes sync by default (chat #70776, 389 queued, never pushed)', () => {
    // A signed-in editor in Specific with no sync setting queued 389 events and never pushed:
    // the mode left `synchronize` to a setting nobody had set, so no pass ever ran.
    expect(resolveInferencePolicy({ mode: 'specific', signedIn: true }).snapshot.synchronize).toBe(true);
    expect(resolveInferencePolicy({ mode: 'hybrid', signedIn: true }).snapshot.synchronize).toBe(true);
    // An explicit "off" still turns it off in a connected mode …
    expect(resolveInferencePolicy({ mode: 'specific', signedIn: true, overrides: { synchronize: false } }).snapshot.synchronize).toBe(false);
    expect(resolveInferencePolicy({ mode: 'hybrid', signedIn: true, overrides: { synchronize: false } }).snapshot.synchronize).toBe(false);
    // … and Local only keeps it off whatever an override says.
    expect(resolveInferencePolicy({ mode: 'local-only', signedIn: true }).snapshot.synchronize).toBe(false);
    expect(resolveInferencePolicy({ mode: 'local-only', signedIn: true, overrides: { synchronize: true } }).snapshot.synchronize).toBe(false);
    // Sync needs an account: signed out, a chosen connected mode does not open it, nor does
    // an explicit "on" override.
    for (const mode of ['hybrid', 'specific'] as const) {
      expect(resolveInferencePolicy({ mode, signedIn: false }).snapshot.synchronize).toBe(false);
      expect(resolveInferencePolicy({ mode, signedIn: false, overrides: { synchronize: true } }).snapshot.synchronize).toBe(false);
      // … while the rest of the chosen mode still applies.
      expect(resolveInferencePolicy({ mode, signedIn: false }).snapshot.gatewayInference).toBe(true);
    }
  });

  it('a signed-out person who never chose sends nothing to the platform', () => {
    const resolved = resolveInferencePolicy({ signedIn: false });
    expect(resolved).toEqual({ mode: 'local-only', chosen: false, snapshot: { ...LOCAL_FIRST_POLICY } });
    const policy = createPlatformPolicy(resolved.snapshot);
    expect(policy.allows('authenticate')).toBe(false);
  });

  it('a signed-in person who never chose runs Hybrid — sync on unless turned off', () => {
    const resolved = resolveInferencePolicy({ signedIn: true });
    expect(resolved.mode).toBe('hybrid');
    expect(resolved.chosen).toBe(false);
    expect(resolved.snapshot.gatewayInference).toBe(true);
    expect(resolved.snapshot.connectedFeatures).toBe(true);
    expect(resolved.snapshot.synchronize).toBe(true);
    expect(resolveInferencePolicy({ signedIn: true, overrides: { synchronize: false } }).snapshot.synchronize).toBe(false);
  });

  it('a chosen mode wins over the derived default', () => {
    expect(resolveInferencePolicy({ mode: 'local-only', signedIn: true })).toMatchObject({ mode: 'local-only', chosen: true });
    expect(resolveInferencePolicy({ mode: 'specific', signedIn: false }).snapshot.directProviders).toBe(true);
  });

  it('an override can switch a capability, except what Local only promises', () => {
    expect(resolveInferencePolicy({ mode: 'hybrid', signedIn: true, overrides: { gatewayInference: false } }).snapshot.gatewayInference).toBe(false);
    const local = resolveInferencePolicy({
      mode: 'local-only',
      signedIn: true,
      overrides: {
        gatewayInference: true, connectedFeatures: true, synchronize: true, directProviders: true,
        externalMcp: true, modelDownloads: true, gitRemotes: true,
      },
    }).snapshot;
    // Local only holds off every egress capability, whatever an override says …
    expect(local).toMatchObject({
      gatewayInference: false, connectedFeatures: false, synchronize: false, directProviders: false,
      externalMcp: false, modelDownloads: false, gitRemotes: false,
    });
    // … but never blocks sign-in itself (the scoped authenticate grant is the way onto Hybrid).
    expect(local.authenticate).toBe(false);
  });

  it('an invalid stored mode reads as unchosen', () => {
    expect(resolveInferencePolicy({ mode: 'cloud' as never, signedIn: true })).toMatchObject({ mode: 'hybrid', chosen: false });
  });
});
