/**
 * A person delivered by a JOB BOARD (no platform account) becomes a candidate here.
 *
 * ── WHO THE PERSON IS ────────────────────────────────────────────────────────────
 * The candidate ref identifies a PERSON, not an application, because erasure (a right
 * exercised by a person) is recorded on the role and must hold across everything that
 * person later sends. In order of preference it is
 *   1. `email:<sha256(lower-cased, trimmed email)>` when the board gave an email — the one
 *      identifier that is the same across boards and across a person's several
 *      applications;
 *   2. `<board>-cand-<candidateId>` — the board's id for the PERSON (not the application);
 *   3. `<board>-app-<applicationId>` — the application id, the last resort.
 * A ref that is not already `[a-z0-9-]{1,64}` is HASHED to a 64-hex digest — never
 * sliced, because two long ids that share a 64-char prefix would become one candidate.
 *
 * ── ERASURE ──────────────────────────────────────────────────────────────────────
 * An erased role is retained and marked so a re-import cannot resurrect the person. The
 * check here is per PERSON: it looks at every ref the same person could have been
 * admitted under (their email ref, their board person-id ref, their application ref), so
 * someone erased under one is refused under the others. Their name and email are not kept
 * after erasure (`attrs` is cleared), so a person erased with NO email, who later arrives
 * WITH one, is caught through the board person-id ref and no further.
 *
 * ── PII ──────────────────────────────────────────────────────────────────────────
 * Name and email live in the role's `attrs` (the one place erasure clears). No lawful
 * basis is asserted: `consent_basis` stays NULL, which reads as "unknown", not
 * "consented" — the recruiter records the basis through `recordCandidateConsent`.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { partyRoles } from '../../infrastructure/database/schema';
import { sha256Hex } from '../../domain/shared/hash';

const REF_RE = /^[a-z0-9-]{1,64}$/;

/** A ref that fits `party_ref`: itself if it already does, otherwise its digest. */
export async function fitPartyRef(raw: string): Promise<string> {
  return REF_RE.test(raw) ? raw : sha256Hex(raw);
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
  /** The ref the candidate is admitted (and the application recorded) under. */
  primary: string;
  /** Every ref this person could be under, `primary` first. */
  all: string[];
}

export async function boardCandidateRefs(ids: BoardPersonIds): Promise<BoardCandidateRefs> {
  const email = ids.email?.trim().toLowerCase();
  const refs: string[] = [];
  if (email) refs.push(await fitPartyRef(`email:${await sha256Hex(email)}`));
  if (ids.candidateId?.trim()) refs.push(await fitPartyRef(`${ids.boardKey}-cand-${ids.candidateId.trim()}`));
  refs.push(await fitPartyRef(`${ids.boardKey}-app-${ids.applicationId}`));
  const all = [...new Set(refs)];
  return { primary: all[0]!, all };
}

/** Whether ANY of these refs belongs to a person who was erased. */
export async function anyRefErased(db: Db, tenantId: number, refs: readonly string[]): Promise<boolean> {
  const rows = await db
    .select({ id: partyRoles.id })
    .from(partyRoles)
    .where(and(
      eq(partyRoles.tenantId, tenantId),
      eq(partyRoles.partyKind, 'person'),
      eq(partyRoles.role, 'candidate'),
      eq(partyRoles.status, 'erased'),
      inArray(partyRoles.partyRef, [...refs]),
    ))
    .limit(1);
  return rows.length > 0;
}

export interface AdmitBoardCandidateInput extends BoardPersonIds {
  tenantId: number;
  name: string | null;
}

/**
 * Register the person as a candidate, unless they were erased. Idempotent: a second
 * application by the same person finds the same role and leaves its consent and
 * retention clock alone.
 */
export async function admitBoardCandidate(
  db: Db,
  input: AdmitBoardCandidateInput,
): Promise<{ admitted: boolean; candidateRef: string }> {
  const refs = await boardCandidateRefs(input);
  if (await anyRefErased(db, input.tenantId, refs.all)) return { admitted: false, candidateRef: refs.primary };
  await db.insert(partyRoles)
    .values({
      tenantId: input.tenantId,
      partyKind: 'person',
      partyRef: refs.primary,
      role: 'candidate',
      status: 'active',
      startedAt: sql`now()`,
      attrs: { source: input.boardKey, boardId: input.applicationId, name: input.name, email: input.email ?? null },
    })
    .onConflictDoNothing({
      target: [partyRoles.tenantId, partyRoles.partyKind, partyRoles.partyRef, partyRoles.role],
    });
  return { admitted: true, candidateRef: refs.primary };
}
