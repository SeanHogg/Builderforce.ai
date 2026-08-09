import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('public API route ordering', () => {
  it('mounts public marketplace feeds before the catch-all domain router', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../index.ts', import.meta.url).href),
      'utf8',
    );

    const domainMount = source.indexOf("app.route('/api', createDomainRoutes(");
    const publicMounts = [
      "app.route('/api/marketplace-stats', createMarketplaceStatsRoutes(db))",
      "app.route('/api/knowledge-market',  createKnowledgeMarketRoutes(db))",
    ];

    expect(domainMount).toBeGreaterThan(-1);
    for (const mount of publicMounts) {
      const publicMount = source.indexOf(mount);
      expect(publicMount, `${mount} must remain registered`).toBeGreaterThan(-1);
      expect(publicMount, `${mount} must precede the catch-all domain router`).toBeLessThan(domainMount);
    }
  });
});
