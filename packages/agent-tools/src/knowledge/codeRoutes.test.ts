import { describe, expect, it } from 'vitest';
import { MAX_ROUTES, routesBadge, scanRoutes } from './codeRoutes.js';

const HONO = "import { Hono } from 'hono';\nconst app = new Hono();\n";

const SRC = `${HONO}
app.get('/users', h);
router.post("/orders/:id", h);
const t = c.get('tenantId');
const u = cache.get('/cached', fallback);
const v = ctx.get('/ctx', 1);
app.route('/api', sub);
router.route('/z').get(h).post(h);
// app.get('/commented', h);
app.get('/a', h).post('/b', h);
`;

describe('scanRoutes', () => {
  it('finds registrations in source order and ignores context lookups and comments', () => {
    expect(scanRoutes(SRC, 'src/routes/x.ts')).toEqual(['GET /users', 'POST /orders/:id', 'ROUTE /api', 'GET /z', 'POST /z', 'GET /a', 'POST /b']);
  });

  it('writes the badge as METHOD path entries joined by ;', () => {
    expect(routesBadge(`${HONO}app.get('/x', h);\napp.delete('/y', h);`, 'a.ts')).toBe('GET /x;DELETE /y');
    expect(routesBadge(`${HONO}const t = c.get('tenantId');`, 'a.ts')).toBeUndefined();
  });

  it('caps at 50 entries', () => {
    const many = Array.from({ length: 60 }, (_, i) => `app.get('/r${i}', h);`).join('\n');
    expect(scanRoutes(`${HONO}${many}`, 'a.ts')).toHaveLength(MAX_ROUTES);
  });

  it('is not fooled by client calls, even in a router file', () => {
    const src = `${HONO}
const a = await axios.get('/x', { params: { q: 1 } });
const b = await api.get(\`/x/\${id}\`, opts);
const c2 = await request(app).get('/x');
const d = await request(app).get('/y', cb);
const e = store.get('/z');
`;
    expect(scanRoutes(src, 'src/client.ts')).toEqual([]);
  });

  it('needs a handler after the path: a one-argument call is a lookup', () => {
    expect(scanRoutes(`${HONO}app.get('/lookup');`, 'a.ts')).toEqual([]);
  });

  it('reads only router files, never test or spec files', () => {
    const body = "app.get('/users', h);";
    expect(scanRoutes(body, 'a.ts')).toEqual([]); // imports no router framework
    expect(scanRoutes(`${HONO}${body}`, 'src/users.test.ts')).toEqual([]);
    expect(scanRoutes(`${HONO}${body}`, 'src/users.spec.ts')).toEqual([]);
    expect(scanRoutes(`${HONO}${body}`, 'src/__tests__/users.ts')).toEqual([]);
    expect(scanRoutes(`import express from 'express';\nconst r = express.Router();\nr.get('/e', h);`, 'a.ts')).toEqual(['GET /e']);
  });

  it('a chained call counts only when it chains from a registration', () => {
    expect(scanRoutes(`${HONO}foo().get('/not', h);`, 'a.ts')).toEqual([]);
    expect(scanRoutes(`${HONO}app.get('/a', h).get('/b', h2).put('/c', h3);`, 'a.ts')).toEqual(['GET /a', 'GET /b', 'PUT /c']);
  });
});
