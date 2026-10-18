/**
 * mountWithLegacyAliases: the canonical path is clean, every alias serves the same
 * router (root and sub-paths) with the Deprecation + successor Link headers.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { legacyAliasNotice, mountWithLegacyAliases } from './legacyAlias';

function router(): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.get('/', (c) => c.text('root'));
  r.get('/:id', (c) => c.text(`id:${c.req.param('id')}`));
  return r;
}

describe('mountWithLegacyAliases', () => {
  const app = new Hono<HonoEnv>();
  mountWithLegacyAliases(app, '/api/managed-agent-hosts', ['/api/managed-claws'], router);

  it('serves the canonical path without deprecation headers', async () => {
    const res = await app.request('/api/managed-agent-hosts/5');
    expect(await res.text()).toBe('id:5');
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it.each(['/api/managed-claws', '/api/managed-claws/5'])('serves %s from the same router, stamped deprecated', async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/managed-agent-hosts>; rel="successor-version"');
  });
});

describe('legacyAliasNotice', () => {
  it('names a concrete successor when given a function', async () => {
    const app = new Hono<HonoEnv>();
    app.get('/old/:id', legacyAliasNotice((c) => `/new/${c.req.param('id')}`), (c) => c.text('ok'));
    const res = await app.request('/old/9');
    expect(res.headers.get('Link')).toBe('</new/9>; rel="successor-version"');
  });
});
