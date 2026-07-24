/**
 * LIVE validation of the web scanner against real public sites — NO mocks, real HTTP.
 *
 * Opt-in only: it makes outbound network calls, so it is skipped in CI / offline and
 * runs only when RUN_LIVE_SCAN=1. This is the repeatable "prove it actually scans a
 * real website" harness:
 *
 *   RUN_LIVE_SCAN=1 npx vitest run src/application/security/WebSecurityScanner.live.test.ts
 *
 * It asserts the scanner DISCRIMINATES — a bare site (example.com: no HSTS/CSP/…,
 * served over HTTP) must score materially lower than a hardened one (github.com) —
 * which a mock could never produce.
 */
import { describe, it, expect } from 'vitest';
import { scanWebTarget } from './WebSecurityScanner';

const live = process.env.RUN_LIVE_SCAN ? describe : describe.skip;

live('web scanner — live', () => {
  it('scores a bare site low and a hardened site high (real HTTP)', async () => {
    const bare = await scanWebTarget('https://example.com');
    const hardened = await scanWebTarget('https://github.com');

    // Real results: example.com is missing the standard security headers; github.com
    // ships nearly all of them.
    expect(bare.findings.length).toBeGreaterThan(hardened.findings.length);
    expect(bare.score).toBeLessThan(hardened.score);
    expect(hardened.score).toBeGreaterThanOrEqual(80);

    // Every finding must carry the fields the ticket pipeline depends on.
    for (const f of bare.findings) {
      expect(f.checkId).toBeTruthy();
      expect(f.title).toBeTruthy();
      expect(f.recommendation).toBeTruthy();
      expect(f.marker).toMatch(/^\[web:[a-z0-9-]+:https?:\/\//);
      expect(['critical', 'high', 'medium', 'low', 'info']).toContain(f.severity);
    }
  }, 60_000);
});
