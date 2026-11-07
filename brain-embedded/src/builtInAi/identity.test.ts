import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_MODELS,
  builtInModelIdentity,
  type NavigatorLike,
} from './identity';

/**
 * Vendor identity is DATA (PRD 42 · Part A1): one table, one detection. The browser's own
 * model is named correctly (Gemini Nano in Chrome, Phi-4-mini in Edge), an unrecognized
 * Chromium build is `unknown` (still servable, labelled generically), and any host
 * without a readable navigator reads as `unknown` too. Nothing here branches a caller on
 * the vendor — it only picks the model id, brand label and fallback window.
 */

const nav = (partial: NavigatorLike): NavigatorLike => partial;

describe('builtInModelIdentity', () => {
  it('names Gemini Nano in Chrome', () => {
    expect(
      builtInModelIdentity(nav({ userAgentData: { brands: [{ brand: 'Google Chrome', version: '138' }] } })),
    ).toEqual({ vendor: 'chrome', model: 'gemini-nano', label: 'Gemini Nano (Chrome)', fallbackContextTokens: 4_096 });
  });

  it('names Phi-4-mini in Edge — Edge is matched before Chromium/Chrome', () => {
    expect(
      builtInModelIdentity(
        nav({
          userAgentData: {
            brands: [
              { brand: 'Microsoft Edge', version: '138' },
              { brand: 'Chromium', version: '138' },
            ],
          },
        }),
      ),
    ).toEqual({ vendor: 'edge', model: 'phi-4-mini', label: 'Phi-4-mini (Edge)', fallbackContextTokens: 4_096 });
  });

  it('trusts userAgentData brands: a Chrome-spoofing UA with no Edge/Chrome brand is unknown', () => {
    expect(
      builtInModelIdentity(
        nav({
          userAgentData: { brands: [{ brand: 'Brave', version: '1' }, { brand: 'Chromium', version: '138' }] },
          userAgent: 'Mozilla/5.0 ... Chrome/138.0.0.0 Safari/537.36',
        }),
      ).vendor,
    ).toBe('unknown');
  });

  it('falls back to the userAgent regex when userAgentData is absent', () => {
    expect(builtInModelIdentity(nav({ userAgent: 'Mozilla/5.0 ... Chrome/138.0.0.0 Safari/537.36' })).vendor).toBe(
      'chrome',
    );
    expect(builtInModelIdentity(nav({ userAgent: 'Mozilla/5.0 ... Edg/138.0.0.0' })).vendor).toBe('edge');
  });

  it('reads an unrecognized or missing navigator as unknown — still servable, labelled generically', () => {
    const expected = { vendor: 'unknown', model: 'built-in', label: 'Built-in model', fallbackContextTokens: 4_096 };
    expect(builtInModelIdentity(nav({ userAgentData: { brands: [{ brand: 'Chromium', version: '138' }] } }))).toEqual(
      expected,
    );
    expect(builtInModelIdentity(nav({}))).toEqual(expected);
    expect(builtInModelIdentity(undefined)).toEqual(expected);
  });

  it('keeps one generic row for each vendor in the table', () => {
    expect(Object.keys(BUILT_IN_MODELS).sort()).toEqual(['chrome', 'edge', 'unknown']);
    expect(BUILT_IN_MODELS.unknown.model).toBe('built-in');
  });
});
