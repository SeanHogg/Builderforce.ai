import { SECRET_SHAPES } from '@builderforce/secret-redaction';
import { describe, expect, it } from 'vitest';
import { scanText } from './engine.js';
import { SCAN_PROFILES } from './profiles.js';
import { SECRET_RULES } from './rules/secretRules.js';

/**
 * AE-G067: the per-shape `requiresContext` hints are a pre-filter, never a narrowing: every sample a shape's regex matches must also
 * pass its hint, and an empty text is never scanned. One sample per shape (the ids of `SECRET_SHAPES`).
 */
const SAMPLES: Record<string, string> = {
  'private-key': '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
  'openai-key': 'const k = "sk-proj-abcdefghijklmnopqrstuv"',
  'github-token': 'token ghp_abcdefghijklmnopqrstuvwxyz0123',
  'github-pat': 'github_pat_abcdefghijklmnopqrstuvwxyz',
  'slack-token': 'xoxb-1234567890-abcdef',
  'slack-rotating-token': 'xoxe.xoxp-1-abcdefghij',
  'slack-app-token': 'xapp-1-A0123456789-abcdef',
  'groq-key': 'gsk_abcdefghij0123',
  'google-api-key': 'AIzaSyabcdefghijklmnopqrstuvwxyz',
  'google-oauth-token': 'ya29.abcdefghijklmnopqrstuvwxyz',
  'google-client-secret': 'GOCSPX-abcdefghijklmnopqrstuv',
  'perplexity-key': 'pplx-abcdefghij12',
  'npm-token': 'npm_abcdefghij12',
  'aws-access-key': 'AKIAABCDEFGHIJKLMNOP',
  'stripe-key': 'sk_live_abcdefgh12',
  'stripe-webhook-secret': 'whsec_abcdefgh12',
  'gitlab-token': 'glpat-abcdefghijklmnopqrstuv',
  'huggingface-token': 'hf_abcdefghijklmnopqrstuvwx',
  'sendgrid-key': 'SG.abcdefghijklmnop.abcdefghijklmnop',
  'builderforce-key': 'bfk_0123456789abcdef',
  'jwt': 'eyJabcdefgh.eyJabcdefgh.abcdefghij',
  'telegram-bot-url': 'https://api.telegram.org/bot123456789:abcdefghijklmnopqrstuvwxyz/getMe',
  'telegram-bot-token': '123456789:abcdefghijklmnopqrstuvwxyz',
};

describe('secret rule pre-filter', () => {
  const rules = SECRET_RULES.filter((r) => r.requiresContext);

  it('hints at least every shape sampled here', () => {
    expect(rules.length).toBeGreaterThanOrEqual(Object.keys(SAMPLES).length);
  });

  for (const rule of rules) {
    it(`${rule.id}: a hint never excludes a text its pattern matches`, () => {
      const matched = Object.values(SAMPLES).filter((s) => rule.pattern.test(s));
      for (const sample of matched) expect(rule.requiresContext!.test(sample)).toBe(true);
    });
  }

  const hinted = SECRET_SHAPES.filter((s) => s.hint);

  it('every hinted shape has a positive sample its regex matches, and its hint passes that sample', () => {
    expect(hinted.length).toBeGreaterThan(0);
    for (const s of hinted) {
      const sample = Object.prototype.hasOwnProperty.call(SAMPLES, s.id) ? SAMPLES[s.id] : undefined;
      expect(sample, `${s.id}: add a positive sample`).toBeDefined();
      const re = new RegExp(s.re.source, s.re.flags.replace(/[gy]/g, ''));
      expect(re.test(sample!), `${s.id}: sample matches the shape`).toBe(true);
      expect(s.hint!.test(sample!), `${s.id}: hint passes the sample`).toBe(true);
    }
  });

  it('a hinted shape regex change forces its hint to be re-checked', () => {
    expect(Object.fromEntries(hinted.map((s) => [s.id, { re: s.re.source, hint: s.hint!.source }]))).toMatchSnapshot();
  });

  it('every sample is still found as a secret finding', () => {
    for (const [id, sample] of Object.entries(SAMPLES)) {
      const found = scanText({ path: 'src/a.ts', content: `${sample}\n` }, 'visualizer');
      expect(found.some((f) => f.category === 'secret'), id).toBe(true);
    }
  });

  it('no rule of any profile matches an empty text, so scanText skips it', () => {
    for (const profile of Object.values(SCAN_PROFILES)) {
      for (const set of profile.ruleSets) for (const rule of set) expect(rule.pattern.test(''), rule.id).toBe(false);
    }
    expect(scanText({ path: 'src/a.ts', content: '' }, 'visualizer')).toEqual([]);
  });

  it('a 6,000-file path-only scan (the knowledge seed) is cheap, and a clean 6,000-file body scan stays bounded', () => {
    const body = 'export function f(a: number) {\n  return a + 1;\n}\n'.repeat(40);
    const t0 = performance.now();
    for (let i = 0; i < 6000; i++) scanText({ path: `src/m${i}/f.ts`, content: '' }, 'visualizer');
    const empty = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 6000; i++) scanText({ path: `src/m${i}/f.ts`, content: body }, 'visualizer');
    const clean = performance.now() - t1;
    // Before the fix the empty scan alone was ~1 ms/file on the host (6.4 s of a 11 s block).
    expect(empty).toBeLessThan(500);
    expect(clean).toBeLessThan(30_000);
  });
});
