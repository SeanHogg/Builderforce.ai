import { describe, expect, it } from 'vitest';
import { paramsOf } from './apiDetail';
import { bodyMethod } from './apiModel';
import { buildTryRequest, clipBody, DEFAULT_BASE_URL, isLocalBase, isSuccess, MAX_BODY_CHARS, parseBaseUrl } from './apiTry';

describe('base URL', () => {
    it('defaults to localhost and accepts only http(s)', () => {
        expect(isLocalBase(parseBaseUrl(DEFAULT_BASE_URL)!)).toBe(true);
        expect(parseBaseUrl('ftp://x')).toBeNull();
        expect(parseBaseUrl('not a url')).toBeNull();
        expect(isLocalBase(parseBaseUrl('https://api.example.com')!)).toBe(false);
        expect(isLocalBase(parseBaseUrl('http://dev.localhost:8080')!)).toBe(true);
    });
});

describe('buildTryRequest', () => {
    const get = { method: 'GET', path: '/users/:id?limit=' };
    it('substitutes and encodes path params and appends filled query params', () => {
        const r = buildTryRequest(get, paramsOf(get), 'http://localhost:3000/', { 'path:id': 'a b', 'query:limit': '5' }, '');
        expect(r).toEqual({ ok: true, req: { method: 'GET', url: 'http://localhost:3000/users/a%20b?limit=5' } });
    });
    it('keeps a base path prefix and leaves out empty query params', () => {
        const r = buildTryRequest(get, paramsOf(get), 'http://localhost:3000/api', { 'path:id': '1' }, '');
        expect(r).toEqual({ ok: true, req: { method: 'GET', url: 'http://localhost:3000/api/users/1' } });
    });
    it('refuses a bad base URL, a missing path value and an invalid body', () => {
        expect(buildTryRequest(get, paramsOf(get), 'nope', { 'path:id': '1' }, '')).toEqual({ ok: false, reason: 'baseUrl' });
        expect(buildTryRequest(get, paramsOf(get), DEFAULT_BASE_URL, {}, '')).toEqual({ ok: false, reason: 'missing', name: 'id' });
        const post = { method: 'POST', path: '/users' };
        expect(buildTryRequest(post, paramsOf(post), DEFAULT_BASE_URL, {}, '{oops')).toEqual({ ok: false, reason: 'body' });
    });
    it('refuses a route that would change the host, and escapes a regex-special param name', () => {
        expect(buildTryRequest({ method: 'GET', path: '@evil.com/x' }, [], DEFAULT_BASE_URL, {}, '')).toEqual({ ok: false, reason: 'origin' });
        // A protocol-relative looking path stays a path on the typed host.
        expect(buildTryRequest({ method: 'GET', path: '//evil.com/x' }, [], DEFAULT_BASE_URL, {}, '')).toEqual({ ok: true, req: { method: 'GET', url: 'http://localhost:3000//evil.com/x' } });
        const odd = [{ name: 'a(b', where: 'path' as const, source: 'route' as const }];
        expect(buildTryRequest({ method: 'GET', path: '/x/{a(b}' }, odd, DEFAULT_BASE_URL, { 'path:a(b': '1' }, '')).toEqual({ ok: true, req: { method: 'GET', url: 'http://localhost:3000/x/1' } });
    });
    it('sends a JSON body for body methods, an empty object by default, and ALL as GET', () => {
        const post = { method: 'POST', path: '/users' };
        expect(buildTryRequest(post, paramsOf(post), DEFAULT_BASE_URL, {}, '')).toEqual({
            ok: true, req: { method: 'POST', url: 'http://localhost:3000/users', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        });
        const all = { method: 'ALL', path: '/x' };
        expect(buildTryRequest(all, [], DEFAULT_BASE_URL, {}, '')).toEqual({ ok: true, req: { method: 'GET', url: 'http://localhost:3000/x' } });
    });
});

describe('buildTryRequest parameter keys', () => {
    it('keeps a path param and a query param of the same name apart', () => {
        const route = { method: 'GET', path: '/items/:id?id=' };
        const r = buildTryRequest(route, paramsOf(route), DEFAULT_BASE_URL, { 'path:id': '7', 'query:id': 'x' }, '');
        expect(r).toEqual({ ok: true, req: { method: 'GET', url: 'http://localhost:3000/items/7?id=x' } });
    });
});

describe('bodyMethod', () => {
    it('is the one rule for which methods carry a body', () => {
        expect(['POST', 'PUT', 'PATCH'].every(bodyMethod)).toBe(true);
        expect(['GET', 'DELETE', 'HEAD', 'ALL'].some(bodyMethod)).toBe(false);
    });
});

describe('response helpers', () => {
    it('clips long bodies and classifies statuses', () => {
        expect(clipBody('abc')).toEqual({ text: 'abc', shortened: false });
        const clipped = clipBody('x'.repeat(MAX_BODY_CHARS + 1));
        expect(clipped.shortened).toBe(true);
        expect(clipped.text).toHaveLength(MAX_BODY_CHARS);
        expect(isSuccess(204)).toBe(true);
        expect(isSuccess(404)).toBe(false);
    });
});
