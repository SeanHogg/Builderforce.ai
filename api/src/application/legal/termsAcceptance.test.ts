/**
 * Consent's decidable invariants (PRD 19 §9 — the terms merge).
 *
 * The GATE half of this module was already tested by the middlewares that call
 * it. What is asserted here is the half the merge added, and every one of these
 * is a rule that fails an AUDIT rather than a build:
 *
 *   - the gate row and the evidence row must be written by ONE call, or the trail
 *     goes missing exactly for the acceptances someone later disputes;
 *   - the evidence row must be append-only, or accepting v2 destroys the proof
 *     that v1 was ever accepted;
 *   - "outstanding" must be a stamped fact, not a version comparison, or the
 *     answer changes retroactively when a version is published and no row says so;
 *   - the person's acceptance and the organisation's binding must stay separate,
 *     which is the conflation that made the BurnRateOS single table unable to
 *     answer either question properly.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOCUMENT_KINDS, TermsError, isDocumentKind } from './termsAcceptance';

// Normalised: the repo has mixed line endings and every assertion below is about
// CODE, not about how the file happens to be checked out.
const src = readFileSync(resolve(__dirname, 'termsAcceptance.ts'), 'utf8').split(String.fromCharCode(13)).join('');
const authRoutes = readFileSync(
  resolve(__dirname, '..', '..', 'presentation', 'routes', 'authRoutes.ts'),
  'utf8',
).split(String.fromCharCode(13)).join('');

const fn = (name: string): string => {
  const at = src.indexOf(`export async function ${name}`);
  expect(at, `${name} should exist`).toBeGreaterThan(-1);
  const rest = src.slice(at + 10);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
};

describe('the document vocabulary is closed', () => {
  it('declares exactly the kinds the schema documents', () => {
    expect([...DOCUMENT_KINDS]).toEqual(['terms', 'privacy', 'dpa', 'aup', 'nda', 'cookie']);
  });

  it('rejects anything outside it, so a typo cannot become an unpromptable document', () => {
    expect(isDocumentKind('terms')).toBe(true);
    expect(isDocumentKind('Terms')).toBe(false);
    expect(isDocumentKind('tos')).toBe(false);
    expect(isDocumentKind(null)).toBe(false);
  });
});

describe('TermsError carries the status the route returns', () => {
  it('defaults to 400 and can carry 404 or 409', () => {
    expect(new TermsError('x').status).toBe(400);
    expect(new TermsError('x', 404).status).toBe(404);
    expect(new TermsError('x', 409).status).toBe(409);
    expect(new TermsError('x')).toBeInstanceOf(Error);
  });
});

describe('the gate row and the evidence row are written together', () => {
  const body = fn('recordAcceptance');

  it('writes both tables in the one function', () => {
    expect(body).toContain('.insert(userLegalAcceptances)');
    expect(body).toContain('.insert(legalDocumentAcceptances)');
  });

  it('upserts the gate row, because the gate only asks what is current', () => {
    expect(body).toContain('.onConflictDoUpdate({');
  });

  it('never updates the evidence row in place — a second click is the same agreement', () => {
    expect(body).toContain('.onConflictDoNothing({');
  });

  it('invalidates the cache, or the accept screen keeps returning 428', () => {
    expect(body).toContain('invalidateAcceptedTermsVersion');
  });

  it('is the single writer the accept endpoint uses', () => {
    expect(authRoutes).toContain("await recordAcceptance(db, c.env, userId, 'terms', terms.version");
    // The endpoint must no longer hand-roll the gate insert beside it.
    const at = authRoutes.indexOf("router.post('/legal/terms/accept'");
    const endpoint = authRoutes.slice(at, at + 2000);
    expect(endpoint).not.toContain('.insert(userLegalAcceptances)');
  });

  it('takes evidence from the request, never from the request body', () => {
    const at = authRoutes.indexOf("router.post('/legal/terms/accept'");
    const endpoint = authRoutes.slice(at, at + 2000);
    expect(endpoint).toContain("c.req.header('cf-connecting-ip')");
    expect(endpoint).toContain("c.req.header('user-agent')");
  });
});

describe('outstanding is a stamped fact, not a comparison', () => {
  it('supersedes every earlier version in one statement', () => {
    const body = fn('supersedeEarlierVersions');
    expect(body).toContain('supersededAt: new Date()');
    expect(body).toContain('documentVersion} <> ');
    // Scoped by KIND, not by party: a per-party loop leaves the platform half
    // superseded for as long as it runs.
    expect(body).not.toContain('partyRef');
  });

  it('reads outstanding off superseded_at rather than recomputing it', () => {
    const body = fn('outstandingFor');
    expect(body).toContain('isNull(legalDocumentAcceptances.supersededAt)');
  });

  it('takes the required list as an argument, so one gate is not every gate', () => {
    expect(src).toContain('required: readonly DocumentKind[]');
  });
});

describe('the person and the organisation stay separate', () => {
  it('binds the organisation on its own table, keyed per tenant', () => {
    const body = fn('bindOrganisation');
    expect(body).toContain('.insert(userTermsAgreements)');
    expect(body).toContain('target: [\n        userTermsAgreements.tenantId,');
    expect(body).toContain('legalEntityName');
    expect(body).toContain('signatoryTitle');
  });

  it('does not route the organisation binding through the person path', () => {
    expect(fn('bindOrganisation')).not.toContain('recordAcceptance(');
  });

  it('reports both halves in the compliance summary, so an unread policy shows', () => {
    const body = fn('tenantComplianceSummary');
    expect(body).toContain('organisationBindings');
    expect(body).toContain('count(distinct ');
  });
});

describe('cross-tenant reads are declared, not forgotten', () => {
  it("uses subject_own_rows for a person's own consent, which follows the person", () => {
    expect(src).toContain("acrossTenants(legalDocumentAcceptances, 'subject_own_rows'");
  });

  it('uses global_uniqueness for supersession, which is platform-wide by design', () => {
    expect(src).toContain("acrossTenants(legalDocumentAcceptances, 'global_uniqueness'");
    expect(src).toContain("acrossTenants(userTermsAgreements, 'global_uniqueness'");
  });

  it('still tenant-scopes the workspace-owned reads', () => {
    expect(src).toContain('scopedToTenant(userTermsAgreements, tenantId');
  });
});

describe('the merge added no schema', () => {
  it('imports only tables that already existed', () => {
    expect(src).toContain('legalDocumentAcceptances');
    expect(src).toContain('userTermsAgreements');
    expect(src).toContain('userLegalAcceptances');
    expect(src).toContain('legalDocuments');
  });

  it('leaves the cached gate exactly as it was', () => {
    // The hot path is the mature side and the merge must not have touched it.
    expect(src).toContain('export async function checkTermsAcceptance');
    expect(src).toContain('const ACTIVE_TERMS_KEY');
    expect(src).toContain('getOrSetCached<VersionBox>');
  });
});
