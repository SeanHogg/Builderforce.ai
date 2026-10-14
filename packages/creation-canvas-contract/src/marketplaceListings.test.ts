import { describe, expect, it } from 'vitest';
import {
  LISTING_DELIVERIES,
  LISTING_HARNESSES,
  LISTING_KIND_IDS,
  deliveriesForKind,
  isEntitlementKind,
  isPublishableObjectKind,
  listingKindSpec,
  requiresWorkspace,
  resolveDelivery,
  resolveListingHarness,
  sessionListingKinds,
} from './marketplaceListings';

describe('the capability listing kind (PRD 33 S6)', () => {
  it('is registered with the entitlement delivery and the instrument harness', () => {
    const spec = listingKindSpec('capability');
    expect(spec).toEqual({
      id: 'capability',
      launch: 'run',
      from: [],
      family: 'asset',
      harness: 'instrument',
      deliveries: ['entitlement'],
      pricing: 'either',
      trial: 'preview',
      icon: '🎥',
    });
    expect(LISTING_KIND_IDS).toContain('capability');
    expect(LISTING_DELIVERIES).toContain('entitlement');
    expect(LISTING_HARNESSES).toContain(spec?.harness);
  });

  it('delivers only the licence, which needs a workspace to hold it', () => {
    expect(deliveriesForKind('capability')).toEqual(['entitlement']);
    expect(resolveDelivery('capability', 'copy')).toBe('entitlement');
    expect(resolveDelivery('capability', null)).toBe('entitlement');
    expect(requiresWorkspace('entitlement')).toBe(true);
    expect(requiresWorkspace('copy')).toBe(true);
    expect(requiresWorkspace('hosted')).toBe(false);
  });

  it('is an entitlement kind, and nothing that hands over a copy is', () => {
    expect(isEntitlementKind('capability')).toBe(true);
    expect(isEntitlementKind('game')).toBe(false);
    expect(isEntitlementKind('app')).toBe(false);
    expect(isEntitlementKind('no-such-kind')).toBe(false);
  });

  it('is never offered from a canvas — not from a board, not from an object', () => {
    expect(sessionListingKinds().map((spec) => spec.id)).not.toContain('capability');
    expect(sessionListingKinds().map((spec) => spec.id)).toEqual(['pack']);
    for (const objectKind of ['website', 'game', 'diagnostics', 'form']) {
      expect(isPublishableObjectKind(objectKind)).toBe(true);
    }
  });

  it('keeps its default harness unless the delivery is hosted', () => {
    expect(resolveListingHarness('capability', null)).toBe('instrument');
    expect(resolveListingHarness('capability', null, 'entitlement')).toBe('instrument');
  });
});
