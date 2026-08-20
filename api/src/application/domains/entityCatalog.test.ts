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
 * `DROP TABLE`, and this file kept its own creates-only copy. So migration 0472 —
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
    //
    // Ceiling moved 11 → 12 (2026-08-19) with `repo_delivery_status` (migration
    // 0931). It is a 1:1 derived-state extension of the already-registered
    // `project_repositories`, unique on the parent's id, holding the verdict a
    // scheduled sweep last read from the provider. It has no identity of its own
    // and nobody opens one — the same structural reason `hosted_listing_lifecycle`
    // below is exempt, and the single writer is the sweep rather than a person.
    //
    // Ceiling moved 6 → 11 (2026-08-18) with the LTI-registrations and
    // enterprise-SSO tables. Every one of the five ADDED here has a structural
    // reason the generic path must not model it, and for three of them the
    // reason is the point of the change rather than an omission:
    //  - `lti_registrations` and `sso_connections` each hold a SEALED CREDENTIAL
    //    (an RSA signing key; an OIDC client secret). The generic reader redacts
    //    on column-name PATTERNS, and betting a signing key on a regex matching
    //    `tool_private_key_enc` is the exact bet migration 0480 exists to avoid —
    //    it moved these off a Cloudflare secret specifically by keeping them out
    //    of any read path that could serve them. Registering them here would put
    //    the hazard back.
    //  - `sso_domains` is a credential-bearing child of a connection
    //    (`verify_token` proves domain control) with no identity of its own; its
    //    key IS the domain.
    //  - `lti_context_bindings` / `lti_resource_bindings` are join rows between
    //    an external LMS coordinate and a canvas object — no title, no status,
    //    nothing a person opens. They are read through `ltiLaunchBridge.ts`.
    //
    // Ceiling moved 5 → 6 (2026-08-17) after checking each of the 5 then-current
    // uncovered tables rather than just the count: all 5 have a bespoke path
    // (`career/references.ts`, `marketplace/creationListings.hosted.ts`,
    // `workflow/workflowVariables.ts`, `marketplace/stageSandboxRuns.ts`) AND a
    // structural reason the GENERIC path cannot model them, not merely a reason
    // nobody wrote the entry yet:
    //  - `professional_references` / `reference_shares` (migration 0476) are
    //    keyed by `user_id` with no `tenant_id` at all — "a reference is part of
    //    a person's career, not a workspace's HR record" — and the catalog
    //    registers into the TENANT-scoped `objects` table, the same structural
    //    reason `freelancer_profiles` beside them has never been entered
    //    (excluded from `created` only because it predates the 0418 series).
    //  - `stage_sandbox_runs` is a content-addressed cache, not an object with
    //    identity — separately adjudicated against the kernel `runs` shape in
    //    check-shape-lint.mjs on the same reasoning.
    //  - `hosted_listing_lifecycle` is a 1:1 derived-state extension of the
    //    already-registered `catalog_items`, PK'd by the parent's own id, with
    //    no identity of its own to register.
    //  - `workflow_variables` is a raw scope/key/value store backing a workflow
    //    node, not a titled object.
    //
    // 2026-08-19: the count held at 12 rather than moving, because the four
    // tables that had accumulated since were adjudicated rather than counted:
    //  - `pay_runs` was already registering into the kernel `objects` table via
    //    its own `object_id` while having NO entity definition — navigable by id
    //    and invisible to the generic layer, the exact halfway state this test
    //    exists to catch. It is now a read-only entity.
    //  - `engagement_milestones` is a titled, dated, priced object a person opens
    //    and acts on; the escrow work simply landed the table ahead of its entry.
    //    Now a read-only entity (its status moves money, so not through a PATCH).
    //  - `collection_actions` is an append-only (invoice, rung) log — the invoice
    //    is the object; this is a fact about what was sent chasing it.
    //  - `repo_delivery_status` is a 1:1 derived-state extension of
    //    `project_repositories`, keyed by the repo it describes, with no identity
    //    of its own — the same structural reason as `hosted_listing_lifecycle`
    //    directly above, and it takes the same exemption.
    //
    // Ceiling moved 12 → 13 (2026-08-19) with `agent_host_channels` (migration
    // 0943), adjudicated rather than counted: it carries `config_enc`, a sealed
    // per-tenant credential the table's own DDL states is "never returned to a
    // client", and it is read through its own bespoke path
    // (`agentHost/agentHostChannels.ts`). That is the SAME structural reason
    // already written above for `lti_registrations` / `sso_connections`: the
    // generic reader redacts on column-name PATTERNS, and betting a sealed
    // channel credential on a regex is the bet those exemptions exist to avoid.
    // Registering it would put the hazard back.
    //
    // Ceiling moved 13 → 14 (2026-08-20) with `run_context_state` (migration 0947),
    // adjudicated rather than counted: it is the Evermind fact store behind the run-context
    // reconciler — one row per (continuity scope, subject key) holding the CURRENT belief a
    // run has been told about one context block. It has no identity a person opens, no
    // title and no status; its key is the belief's subject, and the only reader is
    // `EvermindCognition` through `runContextService.runContextFactStore`. That is the same
    // structural reason `stage_sandbox_runs` is exempt above — a content-keyed cache, not
    // an object — and registering it would publish another run's recalled context as a
    // browsable object on the generic reader.
    //
    // Ceiling moved 14 → 15 (2026-08-20) with `execution_pause_state` (migration 0945),
    // adjudicated rather than counted: it is the exit-and-redispatch payload of a PAUSED
    // run — one row per parked execution whose `loop_state` column holds
    // `{ messages, writtenPaths, step }`, i.e. the run's entire frozen conversation with
    // the model. It has no identity a person opens: its key is the execution, its
    // lifetime is "until someone answers the question", and its only readers are
    // `executionPause.ts` and `executionResume.ts`. Publishing it on the generic reader
    // would make one run's full transcript a browsable object — the same structural
    // reason written above for `run_context_state` and `stage_sandbox_runs`, and a
    // strictly larger hazard, because this is the conversation itself rather than a
    // recalled fragment of it. Its two SIBLINGS from the same pass are registered rather
    // than exempted (`preview_sessions` as a capacity lease, `task_repo_bindings` as the
    // ticket's repo set), so this ceiling moved by exactly one table, not by three.
    expect(missing.length, `uncovered: ${missing.join(', ')}`).toBeLessThan(15);
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
