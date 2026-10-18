import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Each delegate stamps which one ran; the real ones verify the signature.
vi.mock('./authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('userId', 'workspace-token'); await next(); },
}));
vi.mock('./webAuthMiddleware', () => ({
  webAuthMiddleware: async (c: any, next: any) => { c.set('userId', 'web-token'); await next(); },
}));

import { personAuthMiddleware } from './personAuthMiddleware';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims: Record<string, unknown>) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

function app() {
  const a = new Hono<any>();
  a.get('/', personAuthMiddleware, (c) => c.json({ via: c.get('userId') }));
  return a;
}
const call = async (auth?: string) =>
  (await (await app().request('/', auth ? { headers: { Authorization: auth } } : undefined)).json()) as { via: string };

describe('personAuthMiddleware — one person-level endpoint for both token kinds', () => {
  it('routes a workspace token (has `tid`) through authMiddleware', async () => {
    expect((await call(`Bearer ${token({ sub: 'u1', tid: 5, role: 'owner' })}`)).via).toBe('workspace-token');
  });

  it('routes a web token (no `tid`) through webAuthMiddleware', async () => {
    expect((await call(`Bearer ${token({ sub: 'u1', email: 'a@b.c' })}`)).via).toBe('web-token');
  });

  it('hands an undecodable or missing token to webAuthMiddleware, which refuses it', async () => {
    expect((await call('Bearer not-a-jwt')).via).toBe('web-token');
    expect((await call()).via).toBe('web-token');
  });
});
