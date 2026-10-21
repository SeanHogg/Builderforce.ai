import { describe, expect, it } from 'vitest';
import { resolveFundingOrder, strictWhenConnected } from './fundingOrder';

const FREE_FIRST = { allowGatewayAuto: true, freeFirst: true };
/** Connected accounts head the chain, the pool follows — NOT the BYO boundary. */
const BYO_FIRST = { allowGatewayAuto: true };
const BYO_STRICT = { byoRequired: true };

describe('resolveFundingOrder', () => {
  it('an explicit BYO-pool pick is the strict boundary, whatever the preference', () => {
    expect(resolveFundingOrder({ requested: 'byo_pool', byoConfigured: true })).toEqual(BYO_STRICT);
    expect(resolveFundingOrder({ requested: 'byo_pool', preference: 'free_first', byoConfigured: true })).toEqual(BYO_STRICT);
    expect(resolveFundingOrder({ requested: 'byo_pool', preference: 'byo_first', byoConfigured: true })).toEqual(BYO_STRICT);
  });

  it('an explicit per-turn "auto" is free first, over the preference', () => {
    expect(resolveFundingOrder({ requested: 'auto', preference: 'byo_first', byoConfigured: true })).toEqual(FREE_FIRST);
  });

  it('byo_first — explicit or inferred — is connected accounts first, then the pool (never strict)', () => {
    expect(resolveFundingOrder({ preference: 'byo_first', byoConfigured: true })).toEqual(BYO_FIRST);
    expect(resolveFundingOrder({ preference: 'inferred', byoConfigured: true })).toEqual(BYO_FIRST);
    expect(resolveFundingOrder({ byoConfigured: true })).toEqual(BYO_FIRST);
    expect(resolveFundingOrder({ byoConfigured: true })).not.toHaveProperty('byoRequired');
  });

  it('free_first with a connected account puts the free tier ahead of it', () => {
    expect(resolveFundingOrder({ preference: 'free_first', byoConfigured: true })).toEqual(FREE_FIRST);
  });

  it('with nothing connected every preference is the plain cascade', () => {
    expect(resolveFundingOrder({ byoConfigured: false })).toEqual({});
    expect(resolveFundingOrder({ preference: 'inferred', byoConfigured: false })).toEqual({});
    expect(resolveFundingOrder({ preference: 'byo_first', byoConfigured: false })).toEqual({});
    expect(resolveFundingOrder({ preference: 'free_first', byoConfigured: false })).toEqual({});
  });
});

describe('strictWhenConnected — the server-side agent callers', () => {
  it('is byte-identical to the old `configured ? { byoRequired: true } : {}`', () => {
    for (const configured of [true, false]) {
      expect(strictWhenConnected(configured)).toEqual(configured ? { byoRequired: true } : {});
    }
  });
});
