/**
 * A person delivered by a JOB BOARD (no platform account) becomes a candidate here.
 *
 * ── WHO THE PERSON IS ────────────────────────────────────────────────────────────
 * The candidate ref identifies a PERSON, not an application, because erasure (a right
 * exercised by a person) is recorded on the role and must hold across everything that
 * person later sends. The refs a person can arrive under, in order of preference:
 *   1. an HMAC of their lower-cased, trimmed email, keyed per tenant — the one identifier
 *      that is the same across boards and across a person's several applications. It is
 *      KEYED (not a bare SHA-256) because a ref is stored and shown: an unsalted hash of an
 *      email is a lookup table away from the email, and the same address would hash to the
 *      same ref in every tenant;
 *   2. `<board>-cand-<candidateId>` — the board's id for the PERSON;
 *   3. `<board>-app-<applicationId>` — the application id, the last resort.
 * A ref that is not already `[a-z0-9-]{1,64}` is HASHED to a 64-hex digest — never
 * sliced, because two long ids that share a 64-char prefix would become one candidate.
 *
 * ── ONE PERSON, ONE ROLE ─────────────────────────────────────────────────────────
 * The same person can arrive under different refs (first with no email, later with one).
 * The role is looked up across ALL of them: a live role is reused, never a second one
 * inserted beside it, and each other ref is recorded as an ALIAS row (role
 * {@link ALIAS_ROLE}, `attrs.primary` = the role's ref). Alias rows are not candidates —
 * no list or report that reads `role = 'candidate'` sees them — they exist so that
 * erasure and the erased check can see that the refs are ONE person.
 *
 * ── ERASURE ──────────────────────────────────────────────────────────────────────
 * An erased role is retained and marked so a re-import cannot resurrect the person. The
 * erasure (`eraseCandidateRecord`) erases the role AND every alias that names it
 * ({@link linkedCandidateRefs}); the check here refuses a person if ANY of their refs is
 * erased. The link lives in rows erasure does not delete, only marks, so it survives the
 * erasure it exists to serve. Their name and email are not kept after erasure (`attrs`
 * is cleared), so a person erased under refs they never shared with a new arrival (no
 * email then, no board person id now) cannot be recognised — the limit of what is stored.
 *
 * ── PII ──────────────────────────────────────────────────────────────────────────
 * Name and email live in the role's `attrs` (the one place erasure clears). No lawful
 * basis is asserted: `consent_basis` stays NULL, which reads as "unknown", not
 * "consented" — the recruiter records the basis through `recordCandidateConsent`.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { partyRoles } from '../../infrastructure/database/schema';
import { hmacHex } from '../../infrastructure/crypto/hmac';
import { sha256Hex } from '../../domain/shared/hash';
import { credentialSecret } from '../integrations/credentialCrypto';

/** The role of an alias row: another ref of a person whose role is under `attrs.primary`. */
export const ALIAS_ROLE = 'candidate-ref';
const ROLES = ['candidate', ALIAS_ROLE] as const;

const REF_RE = /^[a-z0-9-]{1,64}$/;

/** A ref that fits `party_ref`: itself if it already does, otherwise its digest. */
export async function fitPartyRef(raw: string): Promise<string> {
  return REF_RE.test(raw) ? raw : sha256Hex(raw);
}

/** The per-tenant key the email ref is an HMAC under. */
export function candidateRefKey(env: Env, tenantId: number): string {
  return `${credentialSecret(env)}:candidate-ref:${tenantId}`;
}

export interface BoardPersonIds {
  boardKey: string;
  /** The board's id for the APPLICATION — always present. */
  applicationId: string;
  /** The board's id for the PERSON, when its manifest has one. */
  candidateId?: string | null;
  email?: string | null;
}

export interface BoardCandidateRefs {
  /** The ref a NEW role is admitted under. */
  primary: string;
  /** Every ref this person could be under, `primary` first. */
  all: string[];
}

export async function boardCandidateRefs(ids: BoardPersonIds, key: string): Promise<BoardCandidateRefs> {
  const email = ids.email?.trim().toLowerCase();
  const refs: string[] = [];
  if (email) refs.push(await hmacHex(key, `email:${email}`)); // 64 hex: fits, and is never sliced
  if (ids.candidateId?.trim()) refs.push(await fitPartyRef(`${ids.boardKey}-cand-${ids.candidateId.trim()}`));
  refs.push(await fitPartyRef(`${ids.boardKey}-app-${ids.applicationId}`));
  const all = [...new Set(refs)];
  return { primary: all[0]!, all };
}

interface RoleHit { role: string; status: string; primary: string | null }

/** The candidate and alias rows for a set of refs, by ref — loaded ONCE per page. */
export type RoleIndex = Map<string, RoleHit[]>;

export async function loadRoleIndex(db: Db, tenantId: number, refs: readonly string[]): Promise<RoleIndex> {
  const index: RoleIndex = new Map();
  if (!refs.length) return index;
  const rows = await db
    .select({ partyRef: partyRoles.partyRef, role: partyRoles.role, status: partyRoles.status, attrs: partyRoles.attrs })
    .from(partyRoles)
    .where(and(
      eq(partyRoles.tenantId, tenantId),
      eq(partyRoles.partyKind, 'person'),
      inArray(partyRoles.role, [...ROLES]),
      inArray(partyRoles.partyRef, [...new Set(refs)]),
    ));
  for (const row of rows) {
    const primary = row.role === ALIAS_ROLE ? String((row.attrs as { primary?: unknown } | null)?.primary ?? '') || null : null;
    index.set(row.partyRef, [...(index.get(row.partyRef) ?? []), { role: row.role, status: row.status, primary }]);
  }
  return index;
}

export interface AdmitBoardCandidateInput extends BoardPersonIds {
  tenantId: number;
  name: string | null;
}

/**
 * Register the person as a candidate, unless they were erased. Idempotent: a second
 * application by the same person finds the same role and leaves its consent and
 * retention clock alone.
 *
 * `index` is the page's preloaded {@link RoleIndex}: with it the erased check costs no
 * query per applicant (it is updated as roles are written, so two applicants on one page
 * who are one person still resolve to one role). Without it the index is loaded here.
 */
export async function admitBoardCandidate(
  db: Db,
  input: AdmitBoardCandidateInput,
  refKey: string,
  index?: RoleIndex,
): Promise<{ admitted: boolean; candidateRef: string }> {
  const refs = await boardCandidateRefs(input, refKey);
  const roles = index ?? await loadRoleIndex(db, input.tenantId, refs.all);
  const hits = refs.all.flatMap((ref) => (roles.get(ref) ?? []).map((hit) => ({ ref, ...hit })));
  if (hits.some((hit) => hit.status === 'erased')) return { admitted: false, candidateRef: refs.primary };

  const live = hits.find((hit) => hit.role === 'candidate');
  const alias = hits.find((hit) => hit.role === ALIAS_ROLE && hit.primary);
  const primary = live?.ref ?? alias?.primary ?? refs.primary;

  if (!live && !alias) {
    await db.insert(partyRoles)
      .values({
        tenantId: input.tenantId,
        partyKind: 'person',
        partyRef: primary,
        role: 'candidate',
        status: 'active',
        startedAt: sql`now()`,
        attrs: { source: input.boardKey, boardId: input.applicationId, name: input.name, email: input.email ?? null },
      })
      .onConflictDoNothing({ target: [partyRoles.tenantId, partyRoles.partyKind, partyRoles.partyRef, partyRoles.role] });
    roles.set(primary, [...(roles.get(primary) ?? []), { role: 'candidate', status: 'active', primary: null }]);
  }

  // Every OTHER ref this person has arrived under that has no row yet is linked to the role.
  for (const ref of refs.all) {
    if (ref === primary || (roles.get(ref) ?? []).length > 0) continue;
    await db.insert(partyRoles)
      .values({
        tenantId: input.tenantId,
        partyKind: 'person',
        partyRef: ref,
        role: ALIAS_ROLE,
        status: 'active',
        startedAt: sql`now()`,
        attrs: { primary },
      })
      .onConflictDoNothing({ target: [partyRoles.tenantId, partyRoles.partyKind, partyRoles.partyRef, partyRoles.role] });
    roles.set(ref, [{ role: ALIAS_ROLE, status: 'active', primary }]);
  }
  return { admitted: true, candidateRef: primary };
}

/**
 * Every ref that is the SAME PERSON as `candidateRef`: the ref itself, the role it is an
 * alias of, and every other alias of that role. What erasure must mark together.
 */
export async function linkedCandidateRefs(db: Db, tenantId: number, candidateRef: string): Promise<string[]> {
  const own = await db
    .select({ role: partyRoles.role, attrs: partyRoles.attrs })
    .from(partyRoles)
    .where(and(
      eq(partyRoles.tenantId, tenantId),
      eq(partyRoles.partyKind, 'person'),
      eq(partyRoles.partyRef, candidateRef),
      inArray(partyRoles.role, [...ROLES]),
    ));
  const aliasOf = own.find((row) => row.role === ALIAS_ROLE);
  const primary = aliasOf ? String((aliasOf.attrs as { primary?: unknown } | null)?.primary ?? candidateRef) : candidateRef;
  const siblings = await db
    .select({ partyRef: partyRoles.partyRef })
    .from(partyRoles)
    .where(and(
      eq(partyRoles.tenantId, tenantId),
      eq(partyRoles.partyKind, 'person'),
      eq(partyRoles.role, ALIAS_ROLE),
      sql`${partyRoles.attrs} ->> 'primary' = ${primary}`,
    ));
  return [...new Set([candidateRef, primary, ...siblings.map((row) => row.partyRef)])];
}
