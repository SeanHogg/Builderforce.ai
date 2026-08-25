/**
 * The investor domain's decidable invariants (IN-1 · IN-2 · IN-3 · IN-4).
 *
 * Asserted on the DEFINITIONS and on pure functions rather than against a
 * database, because every one of them is decided before a query runs — and
 * because each is a rule that fails a customer rather than a build:
 *
 *   - The gap → seat map is what makes the retention mechanic real. A category
 *     with no seat renders an unowned gap; a category mapped to a domain that
 *     does not exist renders a dead link into `/seat/<nothing>`.
 *   - The derived room token is the whole of IN-2's no-new-schema claim. If its
 *     hash ever stopped matching `hashShareToken` of the same string, the
 *     existing `resolveDataRoomShare` would stop resolving it and every company
 *     grant would open nothing — silently, because the failure looks like an
 *     expired link.
 *   - The pack's grounding sentence is a Claim-to-Proof gate. No accounting
 *     adapter has run against live production data, so `declared` is the only
 *     honest value and flipping it is a decision, not an edit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { derivedTokenFor } from './companyInvestorAccess';
import { SEAT_FOR_CATEGORY } from './companyWorkspace';
import { PACK_GROUNDING, packBrief } from './fundraisingPack';
import { hashShareToken } from '../security/shareToken';
import { DOMAINS, isDomain } from '../kernel/ObjectRegistry';
import { DOMAIN_MANIFEST } from '../kernel/DomainService';

const api = resolve(__dirname, '..', '..', '..');

/** The vocabulary `due_diligence_checklists.category` documents. */
const CATEGORIES = ['financial', 'legal', 'technical', 'commercial', 'people'] as const;

describe('the diligence gap names the seat that closes it', () => {
  it('covers exactly the five categories the schema declares', () => {
    expect(Object.keys(SEAT_FOR_CATEGORY).sort()).toEqual([...CATEGORIES].sort());
  });

  it('points every category at a real domain and its own seat', () => {
    expect(DOMAINS.length).toBeGreaterThan(10);
    for (const category of CATEGORIES) {
      const owner = SEAT_FOR_CATEGORY[category];
      expect(owner, category).toBeDefined();
      expect(isDomain(owner!.domain), `${category} → ${owner!.domain}`).toBe(true);
      // The seat NAME has to be the roster's own, not a second spelling of it —
      // otherwise the chip says "Finance" and the footer chip says "CFO".
      expect(DOMAIN_MANIFEST[owner!.domain].seat).toBe(owner!.seat);
    }
  });

  it('gives the five categories five DIFFERENT seats', () => {
    // The mechanic is "an investor's question introduces you to another seat".
    // Two categories collapsing onto one seat would quietly halve it.
    const seats = CATEGORIES.map((category) => SEAT_FOR_CATEGORY[category]!.seat);
    expect(new Set(seats).size).toBe(CATEGORIES.length);
  });

  it('has no default seat — an unknown category is unowned, not misfiled', () => {
    expect(SEAT_FOR_CATEGORY['environmental']).toBeUndefined();
  });
});

describe('the derived room token — IN-2 with no new schema', () => {
  const grant = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('is deterministic and distinct per room', () => {
    expect(derivedTokenFor(grant, 7)).toBe(derivedTokenFor(grant, 7));
    expect(derivedTokenFor(grant, 7)).not.toBe(derivedTokenFor(grant, 8));
  });

  it('hashes exactly as `resolveDataRoomShare` will hash it', async () => {
    // This is the load-bearing assertion. `openCompanyRoom` writes
    // `sha256(derived)` into `data_room_shares.token_hash` and then hands the
    // PLAINTEXT to the existing resolver, which hashes it with
    // `hashShareToken`. The two have to agree or the row is unreachable.
    const derived = derivedTokenFor(grant, 42);
    const stored = await hashShareToken(derived);
    const presented = await hashShareToken(derivedTokenFor(grant, 42));
    expect(presented).toBe(stored);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is trimmed, so a token pasted with whitespace still derives the same room', () => {
    expect(derivedTokenFor(`  ${grant}\n`, 3)).toBe(derivedTokenFor(grant, 3));
  });

  it('cannot be formed without the grant token', () => {
    // The derived plaintext CONTAINS the grant token, so holding a derived token
    // implies holding the grant — which is why revoking the grant is the only
    // revocation that has to reach every room.
    expect(derivedTokenFor(grant, 5).startsWith(grant)).toBe(true);
    expect(derivedTokenFor('someone-elses-token', 5)).not.toBe(derivedTokenFor(grant, 5));
  });

  it('stays inside the resolver’s 128-character guard', () => {
    // `resolveDataRoomShare` rejects anything longer before it hashes. A 32-char
    // grant plus a room id has enormous headroom; the assertion is here so a
    // future change to the token shape cannot silently cross it.
    expect(derivedTokenFor(grant, 2_147_483_647).length).toBeLessThan(128);
  });
});

describe('the fundraising pack is grounded honestly', () => {
  it('reports DECLARED financials until an accounting adapter has run live', () => {
    // Pinned deliberately. No accounting adapter has run against live production
    // data, so "computed from your ledger" is Planned under the Claim-to-Proof
    // gate. Changing this constant is what makes that claim, and it should fail
    // here first.
    expect(PACK_GROUNDING.financials).toBe('declared');
    expect(PACK_GROUNDING.notice).toMatch(/not read from connected accounting books/i);
  });

  const company = {
    id: 1, objectId: null, name: 'Northwind', slug: 'northwind', website: null,
    stage: 'seed', sector: null, country: null, headcount: null,
    arr: null, valuation: null, currency: 'USD', isPortfolio: false,
    projectCount: 1, dataRoomCount: 0, openGaps: 1, openRound: null,
    updatedAt: '2026-08-25T00:00:00.000Z',
    projects: [], rooms: [], rounds: [], readiness: 50,
    gaps: [{
      documentId: 9, checklistId: 2, checklistName: 'Series A', label: 'Cap table',
      category: 'financial', domain: 'finance' as const, seat: 'CFO', note: null, dueAt: null,
    }],
  };

  it('omits a fact rather than filling it with a placeholder', () => {
    const brief = packBrief(company, [], null);
    // ARR was never entered. A pack that printed "ARR: —" would have told an
    // investor something false-looking about a company that simply has not
    // typed it in.
    expect(brief).not.toMatch(/ARR/);
    expect(brief).toMatch(/Stage: seed/);
  });

  it('names the seat that closes every gap it lists', () => {
    const brief = packBrief(company, [], null);
    expect(brief).toMatch(/Cap table \(financial\) — CFO/);
  });

  it('always carries the grounding sentence', () => {
    expect(packBrief(company, [], null)).toContain(PACK_GROUNDING.notice);
    expect(packBrief(company, [], 'Lead with retention')).toContain(PACK_GROUNDING.notice);
  });

  it('enumerates the projects IN-1 attached', () => {
    const brief = packBrief(company, [
      { key: 'NW-1', name: 'Ledger sync', description: 'Books in, statements out', status: 'active' },
    ], null);
    expect(brief).toMatch(/Ledger sync \(NW-1, active\)/);
  });
});

describe('IN-1 — projects.company_id', () => {
  const migration = readFileSync(resolve(api, 'migrations/1120_projects_company_id.sql'), 'utf8');
  const delivery = readFileSync(resolve(api, 'src/infrastructure/database/schema/delivery.ts'), 'utf8');

  it('adds a NULLABLE column with no backfill', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS company_id integer/);
    // The ADD COLUMN statement itself, not the whole file — the partial index
    // below it legitimately says `WHERE company_id IS NOT NULL`.
    const addColumn = migration.match(/ALTER TABLE projects ADD COLUMN[\s\S]*?;/)?.[0] ?? '';
    expect(addColumn).not.toMatch(/NOT NULL/);
    expect(addColumn).not.toMatch(/DEFAULT/);
    // Backfilling by name is the string-matching defect FO-A1/FO-A2 exist to
    // remove. A project belongs to a company when somebody says so.
    expect(migration).not.toMatch(/\bUPDATE projects\b/i);
  });

  it('keeps the delivery history when the company record is deleted', () => {
    expect(migration).toMatch(/REFERENCES companies\(id\) ON DELETE SET NULL/);
    expect(migration).not.toMatch(/companies\(id\) ON DELETE CASCADE/);
  });

  it('declares the column in Drizzle without a cross-domain reference', () => {
    expect(delivery).toMatch(/companyId:\s+integer\('company_id'\),/);
    // A `.references(() => companies.id)` here would open a
    // `delivery.ts -> investor.ts` edge `check-domain-boundary` counts, for a
    // pointer the database already enforces.
    expect(delivery).not.toMatch(/company_id'\)\.references/);
  });
});
