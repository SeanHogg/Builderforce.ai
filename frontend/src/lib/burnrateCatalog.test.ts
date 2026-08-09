import { describe, expect, it } from 'vitest';
import {
  BURNRATE_DOMAINS,
  BURNRATE_FOUNDATIONS,
  BURNRATE_PRODUCT_DOMAINS,
  burnrateDomainByHref,
  burnrateDomainBySlug,
} from './burnrateCatalog';

describe('consolidated BurnRateOS catalog', () => {
  it('exposes nine C-suite product domains and three shared foundations', () => {
    expect(BURNRATE_PRODUCT_DOMAINS).toHaveLength(9);
    expect(BURNRATE_FOUNDATIONS).toHaveLength(3);
    expect(BURNRATE_DOMAINS).toHaveLength(12);
  });

  it('keeps every marketing route and workspace target unique and resolvable', () => {
    expect(new Set(BURNRATE_DOMAINS.map((domain) => domain.marketingHref)).size).toBe(BURNRATE_DOMAINS.length);

    for (const domain of BURNRATE_DOMAINS) {
      expect(domain.marketingHref).toMatch(/^\//);
      expect(domain.workspaceHref).toMatch(/^\//);
      expect(burnrateDomainByHref(domain.marketingHref)).toBe(domain);
      if (domain.marketingHref.split('/').length === 2) {
        expect(burnrateDomainBySlug(domain.marketingHref.slice(1))).toBe(domain);
      }
    }
  });
});
