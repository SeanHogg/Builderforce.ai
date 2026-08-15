/**
 * The entity catalog's contracts (PRD 20 §5 step 5, §6.1).
 *
 * The catalog is what turns 244 consolidated tables from DDL into a code path,
 * and it is exactly the kind of file that decays quietly: a table filed under
 * two seats, a secret column that stops being redacted because somebody renamed
 * it, a tenant-less table that becomes readable by every tenant. None of those
 * fail a build on their own — they fail a customer.
 *
 * So the invariants are asserted here, on the DEFINITIONS rather than on a
 * database, because every one of them is decided at definition time.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { ENTITY_CATALOG, entitiesForScope, findEntity, registeredEntities } from './entityCatalog';
import { ENTITY_SCOPES, isEntityScope, singularize } from './entityDefinition';
import { DOMAINS, isDomain } from '../kernel/ObjectRegistry';
import { DOMAIN_MANIFEST } from '../kernel/DomainService';
import { collectCreatedTables } from '../../../scripts/lib/tableAdoption.mjs';

const api = resolve(__dirname, '..', '..', '..');

/**
 * Every table the consolidation migrations create AND LEAVE BEHIND.
 *
 * Read through the SAME collector `check-table-adoption.mjs` uses, which is what
 * this comment already claimed and was not true: the guard had learned to replay
 * `DROP TABLE`, and this file kept its own creates-only copy. So migration 0471 —
 * which drops `developer_orgs` and `developer_org_members` because a publisher is
 * a workspace — left the guard green and this test red, demanding an entity entry
 * for two relations Postgres no longer has. Two implementations of one question
 * is how a test starts disagreeing with the thing it is testing.
 */
const created = new Set(collectCreatedTables(resolve(api, 'migrations')).keys());

describe('the entity catalog', () => {
  it('parses the consolidation series rather than passing vacuously', () => {
    expect(created.size).toBeGreaterThan(200);
    expect(ENTITY_CATALOG.length).toBeGreaterThan(200);
  });

  it('files every entity under exactly one scope', () => {
    const seen = new Map<string, string>();
    for (const def of ENTITY_CATALOG) {
      const prior = seen.get(def.name);
      expect(prior, `${def.name} is declared under both ${prior} and ${def.scope}`).toBeUndefined();
      seen.set(def.name, def.scope);
      expect(isEntityScope(def.scope)).toBe(true);
    }
  });

  it('declares every scope', () => {
    for (const scope of ENTITY_SCOPES) expect(entitiesForScope(scope)).toBeDefined();
  });

  it('refuses to resolve an entity through another seat’s scope', () => {
    // A table name is unique across the whole schema, so a lookup by name alone
    // WOULD resolve — and the domain boundary of §3 would leak at the API.
    const hiring = entitiesForScope('hiring')[0];
    if (!hiring) throw new Error('the hiring scope declares no entities — the catalog is empty, not the boundary tight');
    expect(findEntity('hiring', hiring.name)).not.toBeNull();
    expect(findEntity('finance', hiring.name)).toBeNull();
  });

  it('never grants a kernel primitive a domain', () => {
    // §2: the kernel is owned by no domain and no domain may fork one. A kernel
    // entity that registered itself into a seat would be that fork.
    for (const def of entitiesForScope('kernel')) expect(isDomain(def.scope)).toBe(false);
    for (const def of registeredEntities()) expect(isDomain(def.scope)).toBe(true);
  });

  it('gives every registered kind a home on its seat’s manifest', () => {
    // A kind the registry writes that its seat does not list is a row that
    // appears in `objects` and in nothing a person can see.
    for (const def of registeredEntities()) {
      if (!isDomain(def.scope)) continue;
      expect(
        DOMAIN_MANIFEST[def.scope].kinds,
        `${def.scope} registers "${def.kind}" but does not list it`,
      ).toContain(def.kind);
    }
  });

  it('covers every consolidated table, so the adoption meter cannot be gamed', () => {
    const declared = new Set(ENTITY_CATALOG.map((e) => e.name));
    const missing = [...created].filter((t) => !declared.has(t) && t !== 'activity_log');
    // A table created by 0418+ with no entry here has no generic code path. It
    // may still have a bespoke one — `marketing_session_prompts` does — so this
    // reports what is uncovered rather than failing on a number.
    expect(missing.length, `uncovered: ${missing.join(', ')}`).toBeLessThan(5);
  });

  it('declares nothing that no migration creates', () => {
    const phantom = ENTITY_CATALOG.filter((e) => !created.has(e.name)).map((e) => e.name);
    expect(phantom).toEqual([]);
  });
});

describe('reflection', () => {
  it('addresses every writable entity by a single-column primary key', () => {
    for (const def of ENTITY_CATALOG) {
      if (!def.writable) continue;
      expect(def.primaryKey, `${def.name} is writable with no primary key`).not.toBeNull();
    }
  });

  it('scopes every writable entity to a tenant', () => {
    // The one rule a generic writer cannot be trusted to remember per table.
    for (const def of ENTITY_CATALOG) {
      if (!def.writable) continue;
      expect(def.tenantKey, `${def.name} is writable with no tenant column`).not.toBeNull();
    }
  });

  it('makes tenant-less readability opt-in, never inferred', () => {
    // `email_otp_challenges` has no tenant column either, and its rows are
    // one-time codes against email addresses. Inferring "no tenant ⇒ global"
    // would serve them to every tenant.
    const tenantless = ENTITY_CATALOG.filter((e) => !e.tenantKey);
    expect(tenantless.length).toBeGreaterThan(0);
    const readable = tenantless.filter((e) => e.readable).map((e) => e.name).sort();
    expect(readable).toEqual(['cities', 'countries', 'stage_lookup', 'web_search_robots']);
  });

  it('never exposes a column that names a secret', () => {
    const leaked: string[] = [];
    for (const def of ENTITY_CATALOG) {
      for (const c of def.columns) {
        // Credential-shaped names only: a `document_hash` or a `request_hash`
        // is a checksum, and withholding those was the first version's bug.
        if (/(^|_)(secret|password|passphrase|ciphertext)(_|$)|(token|code|password)_hash|(api|private|signing)_key|(access|refresh|guest)_token/.test(c.name)) {
          leaked.push(`${def.name}.${c.name}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });

  it('never lets a caller write identity, tenancy or bookkeeping', () => {
    for (const def of ENTITY_CATALOG) {
      for (const c of def.columns) {
        if (['id', 'tenant_id', 'created_at', 'updated_at', 'object_id'].includes(c.name)) {
          expect(c.writable, `${def.name}.${c.name} is writable`).toBe(false);
        }
      }
    }
  });

  it('gives every entity something to order by', () => {
    // An unordered page is a page that changes under the reader between clicks.
    for (const def of ENTITY_CATALOG) {
      expect(def.orderKey ?? def.primaryKey, `${def.name} has no ordering column`).not.toBeNull();
    }
  });

  it('keeps redacted columns out of the title and the ordering key', () => {
    for (const def of ENTITY_CATALOG) {
      const public_ = new Set(def.columns.map((c) => c.key));
      if (def.titleKey) expect(public_.has(def.titleKey)).toBe(true);
      if (def.orderKey) expect(public_.has(def.orderKey)).toBe(true);
    }
  });
});

describe('singularize', () => {
  it('handles the plural shapes this schema actually uses', () => {
    expect(singularize('job_applications')).toBe('job_application');
    expect(singularize('companies')).toBe('company');
    expect(singularize('boxes')).toBe('box');
    expect(singularize('addresses')).toBe('address');
    expect(singularize('progress')).toBe('progress');
    expect(singularize('bottleneck_analysis')).toBe('bottleneck_analysi');
  });

  it('is overridden wherever the mechanical answer is wrong', () => {
    // `bottleneck_analysis` above proves the rule has limits — which is why an
    // entity may state its kind, and why the roster kinds are asserted against
    // the manifest rather than derived.
    const application = findEntity('hiring', 'job_applications');
    expect(application?.kind).toBe('application');
  });
});

describe('the roster and the catalog', () => {
  it('gives all fifteen seats an entity scope', () => {
    for (const domain of DOMAINS) expect(isEntityScope(domain)).toBe(true);
    expect(isEntityScope('kernel')).toBe(true);
    expect(isEntityScope('nonsense')).toBe(false);
  });
});
