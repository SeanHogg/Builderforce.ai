import { describe, expect, it } from 'vitest';
import { hostnameOf, isLocalHost, requestScheme, secureCanonicalRedirect } from './secureTransport';

const headers = (entries: Record<string, string> = {}) => new Headers(entries);
const redirect = (url: string, entries?: Record<string, string>) =>
  secureCanonicalRedirect(new URL(url), headers(entries))?.toString() ?? null;

describe('request scheme', () => {
  it('trusts cf-visitor first, then x-forwarded-proto, then the URL', () => {
    expect(requestScheme(headers({ 'cf-visitor': '{"scheme":"http"}', 'x-forwarded-proto': 'https' }), 'https:')).toBe('http');
    expect(requestScheme(headers({ 'x-forwarded-proto': 'http, https' }), 'https:')).toBe('http');
    expect(requestScheme(headers({ 'cf-visitor': 'not json' }), 'http:')).toBe('http');
    expect(requestScheme(headers(), 'https:')).toBe('https');
    expect(requestScheme(headers(), 'http')).toBe('http');
  });
});

describe('secure canonical redirect', () => {
  it('upgrades plain HTTP to HTTPS on the same host, path and query', () => {
    expect(redirect('http://builderforce.ai/about?x=1#h')).toBe('https://builderforce.ai/about?x=1#h');
    expect(redirect('https://builderforce.ai/', { 'cf-visitor': '{"scheme":"http"}' })).toBe('https://builderforce.ai/');
  });

  it('folds www onto the apex and never downgrades the scheme doing it', () => {
    expect(redirect('http://www.builderforce.ai/')).toBe('https://builderforce.ai/');
    expect(redirect('https://www.builderforce.ai/blog?tag=git')).toBe('https://builderforce.ai/blog?tag=git');
  });

  it('serves an HTTPS apex request as is', () => {
    expect(redirect('https://builderforce.ai/dashboard')).toBeNull();
    expect(redirect('https://studio.builderforce.ai/', { 'x-forwarded-proto': 'https' })).toBeNull();
  });

  it('never upgrades a development host', () => {
    expect(redirect('http://localhost:3000/')).toBeNull();
    expect(redirect('http://127.0.0.1:3000/create')).toBeNull();
    expect(redirect('http://studio.localhost:3000/')).toBeNull();
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('builderforce.ai')).toBe(false);
  });

  it('reads the hostname out of a Host header value', () => {
    expect(hostnameOf('localhost:3000')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('[::1]');
    expect(hostnameOf('builderforce.ai')).toBe('builderforce.ai');
  });
});
