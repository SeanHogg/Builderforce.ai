/**
 * The kernel surface's contracts (PRD 20 §7).
 *
 * §7 states the rule that this file exists to keep honest: **the domains and the
 * seats are the same list, and neither may drift from the other.** Three things
 * encode that list today — the api's `DOMAINS`, this client's `DOMAINS`, and the
 * five message catalogs — and every one of them is a place a seat can be added
 * without the other two noticing.
 *
 * Also asserts the two §7.2 non-negotiables a test can actually check: real
 * translations in all five catalogs (not English copies), and the
 * progressive-disclosure rule that a seat is dimmed rather than hidden.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOMAINS, OBJECT_RELATIONS, isDomain } from '@/lib/kernel/kernelApi';
import { earned } from './RosterNav';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

const CATALOGS = { en, zh, es, fr, de } as const;

/** Every leaf key in an object, dotted. */
function leaves(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

function at(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (cur, seg) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[seg] : undefined),
    catalog,
  );
}

describe('the roster is one list', () => {
  /**
   * The roster, written out — and it must stay identical to `EXPECTED` in the api's
   * `kernelContract.test.ts`, which is the drift this file's header is about.
   *
   * This used to be `toHaveLength(15)`, the weaker half of the invariant: a count
   * catches an accidental extra seat and is blind to a renamed one, a reordered one,
   * or a duplicate that keeps the total right.
   */
  const EXPECTED = [
    'growth', 'delivery', 'agents', 'hiring', 'finance', 'revenue', 'commerce',
    'identity', 'people', 'platform', 'governance', 'investor', 'support',
    'canvas', 'integrations', 'operations', 'legal',
  ];

  it('is exactly the roster, in order, with no duplicates', () => {
    expect([...DOMAINS]).toEqual(EXPECTED);
    expect(new Set(DOMAINS).size).toBe(DOMAINS.length);
  });

  it('names every domain in every catalog', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const domain of DOMAINS) {
        const label = at(catalog, `kernel.roster.domain.${domain}`);
        expect(label, `${locale} has no label for ${domain}`).toBeTypeOf('string');
        expect(String(label).length).toBeGreaterThan(0);
      }
    }
  });

  it('describes every domain in every catalog', () => {
    // A surface with no blurb renders an empty paragraph, which reads as a bug
    // rather than as "this seat has nothing to say".
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const domain of DOMAINS) {
        const blurb = at(catalog, `kernel.surface.blurb.${domain}`);
        expect(blurb, `${locale} has no blurb for ${domain}`).toBeTypeOf('string');
      }
    }
  });
});

describe('localisation', () => {
  it('carries the same keys in all five catalogs', () => {
    const base = leaves((en as Record<string, unknown>).kernel).sort();
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const keys = leaves((catalog as Record<string, unknown>).kernel).sort();
      expect(keys, `${locale} diverges from en`).toEqual(base);
    }
  });

  it('translates rather than copying English', () => {
    // §7.2: "real translations in all five catalogs — not English copies." A few
    // strings legitimately match (brand words, "Support" in several languages),
    // so the assertion is on the BULK: a catalog that is mostly identical to en
    // has not been translated.
    const base = leaves((en as Record<string, unknown>).kernel).sort();
    for (const locale of ['zh', 'es', 'fr', 'de'] as const) {
      const identical = base.filter(
        (key) => at(CATALOGS[locale], `kernel.${key}`) === at(en, `kernel.${key}`),
      );
      expect(
        identical.length / base.length,
        `${locale} is ${Math.round((identical.length / base.length) * 100)}% identical to en`,
      ).toBeLessThan(0.15);
    }
  });
});

describe('isDomain', () => {
  it('accepts the roster and rejects everything else', () => {
    for (const d of DOMAINS) expect(isDomain(d)).toBe(true);
    for (const junk of ['', 'Growth', 'billing', 'work', 'pmo', '..']) expect(isDomain(junk)).toBe(false);
  });
});

describe('progressive disclosure', () => {
  it('gates state, never capability', () => {
    // A dimmed CFO is an invitation; a missing CFO is a secret (§7). `earned()`
    // decides the dimming — it never decides presence, and this is the one
    // helper every consumer asks rather than computing a `canX` of its own.
    expect(earned(0, 0)).toBe(true);
    expect(earned(2, 3)).toBe(true);
    expect(earned(3, 3)).toBe(true);
    expect(earned(3, 1)).toBe(false);
  });
});

describe('the entity browser', () => {
  it('has a catalog entry for every key it renders', () => {
    // The browser is ONE component for 244 tables, so a mistyped key is not one
    // broken label — it is the same broken label on every seat. Read from the
    // source rather than restated, so adding a `t('…')` adds an assertion.
    const source = readFileSync(resolve(process.cwd(), 'src/components/kernel/EntityBrowser.tsx'), 'utf8');
    // Fail loudly on an empty read rather than passing over an empty key list.
    expect(source.length).toBeGreaterThan(1000);
    const keys = [...source.matchAll(/\bt\('([a-zA-Z.]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(at(en, `kernel.entities.${key}`), `kernel.entities.${key} is missing`).toBeTypeOf('string');
    }
  });

  it('names the surface sections the seat mounts, in every catalog', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const key of ['kernel.surface.section.records', 'kernel.surface.section.kernel', 'kernel.surface.kernelBlurb']) {
        expect(at(catalog, key), `${locale} is missing ${key}`).toBeTypeOf('string');
      }
    }
  });
});

describe('object relations', () => {
  it('match the five the api exposes and the five the panel tabs', () => {
    expect([...OBJECT_RELATIONS]).toEqual(['activity', 'annotations', 'members', 'shares', 'revisions']);
    for (const rel of ['activity', 'comments', 'members', 'shares', 'revisions']) {
      expect(at(en, `kernel.panel.tab.${rel}`), `no tab label for ${rel}`).toBeTypeOf('string');
    }
  });
});
