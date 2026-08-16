/**
 * The published site's money, now that it lives here rather than beside the
 * asset server.
 *
 * Two things are worth pinning and neither is visible from a mock: that the
 * boundary actually moved (the handlers are gone from `siteServer.ts`, not
 * copied out of it), and that the two rules the module header calls
 * load-bearing are still the first thing it does.
 */
import { describe, expect, it } from 'vitest';
import { handleSiteBilling } from './siteBilling';

async function read(relative: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return readFile(fileURLToPath(new URL(relative, import.meta.url).href), 'utf8');
}

describe('the boundary moved rather than being duplicated', () => {
  it('exports the handler from the marketplace, where the money lives', () => {
    expect(typeof handleSiteBilling).toBe('function');
  });

  it('leaves no copy of the handlers in the serving module', async () => {
    const server = await read('../ide/siteServer.ts');
    // The serving module keeps ONE line about billing: the delegation.
    expect(server).toContain("from '../marketplace/siteBilling'");
    expect(server).not.toContain('async function handleSiteBilling');
    // …and none of the money's collaborators.
    expect(server).not.toContain('startSiteSubscriptionCheckout');
    expect(server).not.toContain('completeSiteSubscription');
    expect(server).not.toContain('cancelSiteSubscription');
  });

  it('shares ONE envelope with the datastore rather than growing a second', async () => {
    const billing = await read('./siteBilling.ts');
    const server = await read('../ide/siteServer.ts');
    expect(billing).toContain("from '../ide/siteServer.http'");
    expect(server).toContain("from './siteServer.http'");
    // Neither file may re-declare the helpers it now imports.
    expect(billing).not.toContain('function jsonResponse');
    expect(server).not.toContain('function jsonResponse');
    expect(server).not.toContain('function corsHeaders');
    expect(server).not.toContain('async function readSubmission');
  });
});

describe('the two rules that must not move', () => {
  it('refuses an anonymous caller before it reaches any money', async () => {
    const source = await read('./siteBilling.ts');
    const body = source.slice(source.indexOf('export async function handleSiteBilling'));
    const signInRefusal = body.indexOf("Sign in first.");
    for (const collaborator of [
      'subscriberStanding',
      'startSiteSubscriptionCheckout',
      'completeSiteSubscription',
      'cancelSiteSubscription',
      // The two abandonment remedies answer here too, and neither may be reachable
      // by somebody the site has not identified: one hands over a person's own data
      // and the other hands over a build.
      'exportOwnedSiteRecords',
      'takeAbandonedBuild',
    ]) {
      expect(body.indexOf(collaborator)).toBeGreaterThan(signInRefusal);
    }
  });

  it('takes the seller tenant off the resolved SITE and never off the request', async () => {
    const source = await read('./siteBilling.ts');
    const body = source.slice(source.indexOf('export async function handleSiteBilling'));
    // Every tenant/site id handed to the money comes from `site`, which the
    // caller resolved from the Host header — never from a parsed body.
    expect(body).toContain('tenantId: site.tenantId');
    expect(body).toContain('siteId: site.siteId');
    expect(body).not.toMatch(/tenantId:\s*(body|Number\(body)/);
  });

  it('rebuilds the return URL from the request origin, never from the body', async () => {
    const source = await read('./siteBilling.ts');
    expect(source).toContain("new URL(request.url).origin + '/'");
    expect(source).not.toMatch(/returnUrl:\s*String\(body/);
  });
});

describe('the two deliberate public exceptions', () => {
  it('answers widget.js and listing BEFORE the sign-in gate — same facts a shop window already shows a stranger', async () => {
    const source = await read('./siteBilling.ts');
    const body = source.slice(source.indexOf('export async function handleSiteBilling'));
    const signInRefusal = body.indexOf('Sign in first.');
    expect(body.indexOf("action === 'widget.js'")).toBeLessThan(signInRefusal);
    expect(body.indexOf("action === 'listing'")).toBeLessThan(signInRefusal);
    // And accept-update — a money-adjacent write — is NOT one of the exceptions.
    expect(body.indexOf("action === 'accept-update'")).toBeGreaterThan(signInRefusal);
  });
});
