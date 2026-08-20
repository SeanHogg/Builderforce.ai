import { describe, expect, it } from 'vitest';
import { HRMS_CONNECTORS } from './hrms';
import { BUILTIN_CONNECTOR_LIST } from './index';
import { parseConnectorManifest } from '../connectorManifest';

/**
 * These are DATA, and the thing that makes data dangerous is that it ships
 * without a code review of what it can do. Three properties are asserted here
 * because each of them, broken, is a defect nothing else in the build would
 * notice.
 */
describe('the HRMS / ATS catalog', () => {
  it('is read-only, and stays that way', () => {
    // The whole premise of the file: an HRMS is the system of record for
    // somebody's employment, and a mistaken write into it is a person's salary or
    // their termination date. A `mutates: true` action appearing here is not a
    // new feature, it is a decision to be reversed — which is why this asserts on
    // the flag rather than on the HTTP method. HiBob's roster read is a POST, so
    // a method-based check would have to make an exception and would then miss
    // the case it exists to catch.
    const writes = HRMS_CONNECTORS.flatMap((m) =>
      m.actions.filter((a) => a.mutates).map((a) => `${m.key}.${a.key}`));
    expect(writes).toEqual([]);
  });

  it('never re-declares a vendor the catalog already carries', () => {
    // Rippling is the case that caught this: `defaults/payroll.ts` already reaches
    // the same base URL with `list_employees` on it, so a second card would have
    // been a second connection, a second credential, and two answers to "who works
    // here". Comparing BASE URLs rather than keys is what makes that detectable —
    // two different keys on one API is exactly the shape that slips through.
    // A base URL that is ENTIRELY a placeholder names no vendor — it is "whatever
    // host the customer gives us", which `scim-directory`, `http` and
    // `website-publisher` all are. Comparing those to each other finds a
    // collision that does not exist, so they are excluded rather than allowlisted:
    // the question this test asks is "do two cards point at the same VENDOR", and
    // a bring-your-own-host connector has no answer to it.
    const isBringYourOwnHost = (base: string) => /^\{\{\s*auth\.[a-zA-Z0-9_]+\s*\}\}$/.test(base.trim());

    const byBase = new Map<string, string[]>();
    for (const manifest of BUILTIN_CONNECTOR_LIST) {
      if (isBringYourOwnHost(manifest.baseUrl)) continue;
      const base = manifest.baseUrl.toLowerCase();
      byBase.set(base, [...(byBase.get(base) ?? []), manifest.key]);
    }
    for (const manifest of HRMS_CONNECTORS) {
      if (isBringYourOwnHost(manifest.baseUrl)) continue;
      const sharing = (byBase.get(manifest.baseUrl.toLowerCase()) ?? []).filter((k) => k !== manifest.key);
      // Greenhouse is the ONE deliberate exception, and it is deliberate for a
      // reason the file states: publishing a requisition and reading the candidate
      // pipeline are done by different people and must be separately grantable.
      const allowed = manifest.key === 'greenhouse-ats' ? ['greenhouse-job-board'] : [];
      expect(sharing, `${manifest.key} shares a base URL with ${sharing.join(', ')}`).toEqual(allowed);
    }
  });

  it('asks for every credential its base URL interpolates', () => {
    // A per-customer host is the norm here — Workday, BambooHR and SuccessFactors
    // are all deployed per tenant — so a `{{auth.x}}` with no field behind it
    // would send the literal placeholder upstream and fail with a DNS error that
    // reads like the customer's network is broken.
    for (const manifest of HRMS_CONNECTORS) {
      const referenced = [...manifest.baseUrl.matchAll(/\{\{\s*auth\.([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
      const declared = new Set(manifest.auth.fields.map((f) => f.key));
      for (const key of referenced) {
        expect(declared.has(key!), `${manifest.key} interpolates auth.${key} but never asks for it`).toBe(true);
      }
    }
  });

  it('passes the same validator a tenant-authored manifest passes', () => {
    // `validateBuiltinCatalog` already covers this for the catalog as a whole;
    // asserting it here too means a broken manifest names THIS file rather than
    // being one line in a 78-connector failure.
    for (const manifest of HRMS_CONNECTORS) {
      expect(() => parseConnectorManifest(JSON.parse(JSON.stringify(manifest)))).not.toThrow();
    }
  });

  it('is reachable from the catalog every tenant reads', () => {
    // The gap this file closes was "the category is absent", so the assertion that
    // matters is not that the manifests exist but that they are REGISTERED —
    // a file nobody imports would satisfy every test above and change nothing.
    const registered = new Set(BUILTIN_CONNECTOR_LIST.map((m) => m.key));
    for (const manifest of HRMS_CONNECTORS) expect(registered.has(manifest.key)).toBe(true);
  });
});
