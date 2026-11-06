/**
 * The sandbox's request, built as a pure function: the base URL the PERSON typed (it defaults
 * to localhost and is never filled in from the graph), the endpoint's path parameters
 * substituted, its query parameters appended and a JSON body validated. The view never sends
 * anything itself: a host that offers `tryRequest` performs it and enforces its own origin
 * rule; this module only refuses what can never be a request.
 */

import type { TryRequest } from '../../types';
import { paramKey, type ParamRow } from './apiDetail';
import { bodyMethod, type Route } from './apiModel';

export const DEFAULT_BASE_URL = 'http://localhost:3000';

/** The most response body characters the drawer shows. */
export const MAX_BODY_CHARS = 4000;

/** The typed base URL as a URL, or null when it is not an http(s) address. */
export function parseBaseUrl(text: string): URL | null {
    try {
        const url = new URL(text.trim());
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Whether the address is this machine (shown as a hint; the host enforces its own rule). */
export const isLocalBase = (url: URL): boolean => LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost');

export type BuiltRequest =
    | { ok: true; req: TryRequest }
    | { ok: false; reason: 'baseUrl' | 'origin' | 'missing' | 'body'; name?: string };

/** `values` maps a parameter's key (`paramKey`: where and name) to what the person typed; `body` is the JSON text of a body-bearing method. */
export function buildTryRequest(route: Route, params: readonly ParamRow[], baseUrl: string, values: Readonly<Record<string, string>>, body: string): BuiltRequest {
    const base = parseBaseUrl(baseUrl);
    if (!base) return { ok: false, reason: 'baseUrl' };
    let path = route.path.split('?', 1)[0]!;
    for (const p of params.filter((x) => x.where === 'path')) {
        const value = (values[paramKey(p)] ?? '').trim();
        if (!value) return { ok: false, reason: 'missing', name: p.name };
        const name = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        path = path.replace(new RegExp(`:${name}(?![A-Za-z0-9_])|\\{${name}\\}`), encodeURIComponent(value));
    }
    const query = new URLSearchParams();
    for (const p of params.filter((x) => x.where === 'query')) {
        const value = (values[paramKey(p)] ?? '').trim();
        if (value) query.set(p.name, value);
    }
    const method = route.method === 'ALL' ? 'GET' : route.method;
    const qs = query.toString();
    const text = `${base.origin}${base.pathname.replace(/\/$/, '')}${path}${qs ? `?${qs}` : ''}`;
    // A route like `@evil.com/x` or `//evil.com/x` must stay a path on the typed host, never change it.
    let built: URL;
    try {
        built = new URL(text);
    } catch {
        return { ok: false, reason: 'origin' };
    }
    if (built.origin !== base.origin) return { ok: false, reason: 'origin' };
    const url = built.href;
    if (!bodyMethod(method)) return { ok: true, req: { method, url } };
    const json = body.trim() || '{}';
    try {
        JSON.parse(json);
    } catch {
        return { ok: false, reason: 'body' };
    }
    return { ok: true, req: { method, url, headers: { 'Content-Type': 'application/json' }, body: json } };
}

/** The body, shortened to the drawer's limit; `shortened` says whether it was cut. */
export function clipBody(body: string): { text: string; shortened: boolean } {
    return body.length > MAX_BODY_CHARS ? { text: body.slice(0, MAX_BODY_CHARS), shortened: true } : { text: body, shortened: false };
}

/** 2xx reads as success; anything else is shown as a warning. */
export const isSuccess = (status: number): boolean => status >= 200 && status < 300;
