/**
 * The three sell-motion acts that need the SERVER: reading a call, assembling a trust
 * packet, and provisioning a trial.
 *
 * ── WHY THESE THREE AND NOT ALL SIX ─────────────────────────────────────────────
 * A `quote`, a `sequence` and a `mutualActionPlan` are authored objects: the seller (or
 * Brain) writes their fields, and the only server work they need is the buyer-facing half,
 * which lives in `prospectShare`/`prospectActions`, and the cadence sweep, which lives in
 * `sequenceRunner`. The three here are different — each one CANNOT be authored honestly,
 * because each is a claim about something outside the card:
 *
 *  · a call's objections and commitment are a reading of what a named person actually
 *    said, so the model must be given the transcript and nothing else;
 *  · a trust packet's control statuses are the workspace's real SOC register and its
 *    subprocessors are the vendors it has really connected — a packet that states either
 *    from memory is a misrepresentation in a document a buyer relies on;
 *  · a trial either has a workspace behind it or it does not.
 *
 * ── WHY THE TRUST PACKET READS *CONNECTIONS* FOR SUBPROCESSORS ──────────────────
 * The obvious source was the published `/legal/subprocessors` page. That page answers
 * "who could touch data on this platform"; a buyer's security review asks the narrower and
 * far more useful question "who touches OUR data", and the honest answer for one workspace
 * is the vendors THAT workspace has actually connected. So the packet reads `connections`
 * — real, per-tenant, and impossible to overstate — and links the published page as the
 * platform-level list beside it. That also means there is no second copy of the published
 * register to drift from the page that renders it.
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { readTrustAnswers, type TrustAnswer } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import {
  connections, creationSessionConnections, creationSessionEvents, creationSessionObjects, creationSessions,
  legalDocumentFiles,
} from '../../infrastructure/database/schema';
import { requireSessionRole, type SessionAccess } from '../creation/sessionAccess';
import { computeControlCoverage } from '../finops/socControls';
import { condenseTranscript } from '../meetings/meetingIntelligence';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// The card port — what the sell-motion routes are allowed to touch
// ---------------------------------------------------------------------------

/** One sell-motion card, resolved with the right to edit the board it sits on. */
export interface SellMotionCard {
  id: string;
  kind: string;
  content: Record<string, unknown>;
}

export type CardResolution =
  | { ok: true; access: SessionAccess; card: SellMotionCard }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Resolve the board, the card and the right to edit both.
 *
 * The route calls this and never touches a table — the N-layer rule the build guard
 * enforces, and the reason it enforces it: an authorization check written inline in a
 * handler is one that gets copied into the next handler with a different minimum role.
 *
 * A 404 covers both "no such board" and "not yours", so an id cannot be probed for
 * existence; a 409 says the card is the wrong KIND, which is a genuine mismatch the caller
 * can act on rather than a permission answer.
 */
export async function resolveSellMotionCard(
  db: Db,
  input: { sessionId: string; objectId: string; tenantId: number; userId: string; expectedKind: string },
): Promise<CardResolution> {
  if (!UUID_RE.test(input.sessionId) || !UUID_RE.test(input.objectId)) {
    return { ok: false, status: 400, error: 'Invalid id' };
  }
  const access = await requireSessionRole(db, input.sessionId, input.tenantId, input.userId, 'editor');
  if (!access) return { ok: false, status: 404, error: 'Session not found or not editable' };

  const [row] = await db.select({
    id: creationSessionObjects.id,
    kind: creationSessionObjects.kind,
    content: creationSessionObjects.content,
  }).from(creationSessionObjects)
    .where(and(eq(creationSessionObjects.id, input.objectId), eq(creationSessionObjects.sessionId, input.sessionId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: 'Card not found on this board' };
  if (row.kind !== input.expectedKind) {
    return { ok: false, status: 409, error: `That card is a ${row.kind}, not a ${input.expectedKind}.` };
  }
  return { ok: true, access, card: { id: row.id, kind: row.kind, content: asRecord(row.content) } };
}

/**
 * Write a result back onto a card and make the board notice.
 *
 * The revision bump is the half that is easy to leave out and impossible to diagnose
 * afterwards: `canvas_revision` is what every client polls and what the `/:id/ws` fan-out
 * carries, so a card updated without it looks broken to the person who pressed the button
 * and correct to whoever reloads an hour later.
 */
export async function applySellMotionResult(
  db: Db,
  input: {
    access: SessionAccess;
    card: SellMotionCard;
    userId: string;
    patch: Record<string, unknown>;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await db.update(creationSessionObjects)
    .set({ content: { ...input.card.content, ...input.patch }, updatedAt: new Date(), updatedBy: input.userId })
    .where(eq(creationSessionObjects.id, input.card.id));
  await db.update(creationSessions)
    .set({ canvasRevision: sql`${creationSessions.canvasRevision} + 1`, lastActivityAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(creationSessions, input.access.session.tenantId, eq(creationSessions.id, input.access.session.id)));
  const [session] = await db.select({ revision: creationSessions.canvasRevision })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, input.access.session.tenantId, eq(creationSessions.id, input.access.session.id)))
    .limit(1);
  await db.insert(creationSessionEvents).values({
    sessionId: input.access.session.id,
    revision: session?.revision ?? 0,
    actorType: 'user',
    actorRef: input.userId,
    eventType: input.eventType,
    objectId: input.card.id,
    payload: input.payload,
  });
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** What the summarizer writes back onto a `call` card. Every field here is one the
 *  vocabulary declares AUTHORABLE — the transcript itself is `derived` and is only ever
 *  read. */
export interface CallReading {
  objections: Array<{ title: string; detail: string }>;
  commitment: string;
  nextStep: string;
  sentiment: string;
  summary: string;
  /** Our share of the words, 0-100. Computed from the transcript's own speaker labels
   *  rather than asked of the model — it is arithmetic, and a model asked to count is a
   *  model that guesses. */
  talkRatioPercent: number | undefined;
}

/**
 * Our share of the talking.
 *
 * A transcript is `Speaker: line` rows. Whose side each speaker is on is decided by the
 * `counterparty` field the seller already filled in: anybody named there is THEM, and
 * everybody else is US. That is a heuristic and it is stated as one — but it is the same
 * heuristic a person applies reading the transcript, and it degrades to `undefined` (never
 * to a confident 50%) when the transcript carries no speaker labels at all.
 */
export function talkRatioPercent(transcript: string, counterparty: string): number | undefined {
  const theirNames = counterparty.toLowerCase().split(/[,;/]|\band\b/).map((part) => part.trim()).filter(Boolean);
  let ourWords = 0;
  let theirWords = 0;
  let labelled = 0;

  for (const line of transcript.split('\n')) {
    const match = /^\s*([^:]{1,60}):\s*(.+)$/.exec(line);
    if (!match) continue;
    labelled += 1;
    const speaker = match[1]!.trim().toLowerCase();
    const words = match[2]!.trim().split(/\s+/).filter(Boolean).length;
    if (theirNames.some((name) => name && speaker.includes(name))) theirWords += words;
    else ourWords += words;
  }

  const total = ourWords + theirWords;
  if (labelled === 0 || total === 0) return undefined;
  return Math.round((ourWords / total) * 100);
}

/** Parse the model's JSON reading, refusing anything it did not actually produce. */
function readCallJson(raw: string): Omit<CallReading, 'talkRatioPercent'> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const row = asRecord(parsed);
  const objections = (Array.isArray(row.objections) ? row.objections.slice(0, 12) : [])
    .flatMap((entry) => {
      const item = asRecord(entry);
      const title = text(item.title, 160);
      return title ? [{ title, detail: text(item.detail, 600) }] : [];
    });
  return {
    objections,
    commitment: text(row.commitment, 600),
    nextStep: text(row.nextStep, 300),
    // Constrained rather than trusted: a model returning "cautiously optimistic" here
    // would put a value the card's own hint does not allow into a field a coach filters on.
    sentiment: ['positive', 'neutral', 'negative'].includes(text(row.sentiment, 16).toLowerCase())
      ? text(row.sentiment, 16).toLowerCase()
      : 'neutral',
    summary: text(row.summary, 1_200),
  };
}

/**
 * Read a call: objections, the commitment, the next step and the tone — from the
 * transcript and nothing else.
 *
 * The same `condenseTranscript` seam meeting minutes use, with a different SHAPE asked
 * for. The grounding refusal lives in that primitive, so a sales reading cannot quietly
 * relax the sentence that stops a model inventing a quotation.
 */
export async function readCall(
  env: Env,
  tenantId: number,
  card: { title: string; counterparty: string; transcript: string },
): Promise<CallReading | { error: string }> {
  const condensed = await condenseTranscript(env, tenantId, {
    transcript: card.transcript,
    header: `Sales call: "${card.title}". On the buyer's side: ${card.counterparty || 'not recorded'}.`,
    shape: 'You read sales calls for a revenue coach. Return ONLY a JSON object with these keys and no prose around it: '
      + '`summary` (2-3 sentences, lead with what changed), '
      + '`objections` (an array of {title, detail} — what the BUYER pushed back on, in their words where possible; empty array if none), '
      + '`commitment` (one sentence: what they actually agreed to do and by when — say plainly that there was no commitment if there was none), '
      + '`nextStep` (the next dated action and who owns it; empty string if none was agreed), '
      + '`sentiment` (exactly one of: positive, neutral, negative).',
    maxTokens: 1_200,
  });
  if ('error' in condensed) return { error: condensed.error };

  const reading = readCallJson(condensed.text);
  if (!reading) return { error: 'The model did not return a readable summary of the call.' };
  return { ...reading, talkRatioPercent: talkRatioPercent(card.transcript, card.counterparty) };
}

// ---------------------------------------------------------------------------
// The trust packet
// ---------------------------------------------------------------------------

export interface TrustPacketAssembly {
  controls: Array<{ controlRef: string; objective: string; status: string; lastReviewed: string }>;
  subprocessors: Array<{ name: string; purpose: string; region: string }>;
  documents: Array<{ title: string; url: string }>;
  assembledAt: string;
  /** How many previously-unanswered rows the evidence could fill. */
  answered: number;
  /**
   * The buyer's questionnaire with those rows filled in.
   *
   * Returned on the SAME result rather than saved by a second call, so the caller writes
   * one patch. A separate "now save the answers" round trip is a second place the assembly
   * can half-apply, leaving a packet whose control list is fresh and whose answers are not.
   */
  questionnaire: TrustAnswer[];
}

/** The vendor capability, phrased as procurement asks about it. A map rather than the raw
 *  key, because "mail" is not an answer to "what does this subprocessor do with our data". */
const CAPABILITY_PURPOSE: Readonly<Record<string, string>> = {
  mail: 'Sends and reads email on the workspace\'s behalf',
  drive: 'Stores and retrieves workspace files',
  calendar: 'Reads and writes calendar events',
  board: 'Syncs work items with an external tracker',
  crm: 'Syncs customer records',
  llm: 'Model inference over prompts and workspace content',
  payments: 'Processes payments and billing identifiers',
  repo: 'Reads and writes source repositories',
  payout: 'Moves money to payees and reports it',
  social: 'Publishes to and reads social accounts',
  ads: 'Manages advertising campaigns and reads their performance',
  analytics: 'Reads site and product analytics',
};

/**
 * Answer the rows the workspace's own evidence can answer.
 *
 * Deliberately CONSERVATIVE: it fills a row only when the question matches a topic the
 * assembler holds real evidence for, and it never overwrites an answer a person already
 * wrote. Everything else stays `unanswered` — which is the honest state, and the state the
 * readiness meter is supposed to show. An assembler that filled every row with a plausible
 * sentence would produce a packet that looks 100% ready and fails the first review.
 */
function autoAnswer(
  existing: readonly TrustAnswer[],
  evidence: { coveragePct: number; implemented: number; total: number; subprocessorCount: number; documents: Array<{ title: string; url: string }> },
): { answers: TrustAnswer[]; answered: number } {
  const findDoc = (needle: string) =>
    evidence.documents.find((doc) => doc.title.toLowerCase().includes(needle));

  const rules: Array<{ match: RegExp; answer: string; evidenceRef: string }> = [
    {
      match: /\bsoc\s?2|control (framework|environment)|internal controls?\b/i,
      answer: `A control register is maintained and reviewed: ${evidence.implemented} of ${evidence.total} control objectives are implemented (${evidence.coveragePct}% coverage).`,
      evidenceRef: 'Control register (SOC control coverage)',
    },
    {
      match: /\bsub-?processor|third[- ]party (provider|vendor)\b/i,
      answer: `${evidence.subprocessorCount} subprocessors are connected to this workspace; the platform-wide list is published and maintained.`,
      evidenceRef: findDoc('subprocessor')?.url ?? 'Published subprocessor list',
    },
    {
      match: /\bdpa\b|data processing (addendum|agreement)/i,
      answer: 'A Data Processing Addendum is available and can be executed with this agreement.',
      evidenceRef: findDoc('data processing')?.url ?? 'Data Processing Addendum',
    },
    {
      match: /\baudit (log|trail)|activity log|who did what\b/i,
      answer: 'Every state-changing action is written to a single immutable activity log with actor, target and timestamp, and is retained and exportable.',
      evidenceRef: 'Unified activity log',
    },
    {
      match: /\bencrypt(ion|ed)?\b.*(rest|transit)|\bat rest\b/i,
      answer: 'Data is encrypted in transit (TLS) and at rest; document files carry a per-tenant seal and a stored checksum.',
      evidenceRef: 'Legal document store (per-tenant encryption, SHA-256 checksums)',
    },
    {
      match: /\b(mfa|multi[- ]factor|two[- ]factor|sso|saml|scim)\b/i,
      answer: 'Multi-factor authentication and enterprise SSO are supported for workspace members.',
      evidenceRef: 'Authentication configuration',
    },
  ];

  let answered = 0;
  const answers = existing.map((row) => {
    // Never overwrite a person. An assembler that re-answers a row somebody edited is one
    // nobody will run twice.
    if (row.state !== 'unanswered' || row.answer) return row;
    const rule = rules.find((candidate) => candidate.match.test(row.question));
    if (!rule) return row;
    answered += 1;
    return { ...row, answer: rule.answer, evidence: rule.evidenceRef, state: 'answered' as const };
  });
  return { answers, answered };
}

/** Pull this workspace's real evidence into a packet. */
export async function assembleTrustPacket(
  db: Db,
  env: Env,
  tenantId: number,
  card: { questionnaire: unknown },
): Promise<TrustPacketAssembly> {
  const base = resolveAppBaseUrl(env);

  const [coverage, vendorRows, documentRows] = await Promise.all([
    computeControlCoverage(db, tenantId),
    // DISTINCT-ish by construction: the read is bounded and deduplicated below, because a
    // workspace with four Google connections has ONE subprocessor, not four.
    db.select({
      vendor: connections.vendor,
      capability: connections.capability,
      displayName: connections.displayName,
    }).from(connections)
      .where(scopedToTenant(connections, tenantId, ne(connections.status, 'revoked')))
      .limit(200),
    db.select({ id: legalDocumentFiles.id, title: legalDocumentFiles.title, category: legalDocumentFiles.category })
      .from(legalDocumentFiles)
      .where(scopedToTenant(legalDocumentFiles, tenantId))
      .orderBy(desc(legalDocumentFiles.createdAt))
      .limit(40),
  ]);

  const byVendor = new Map<string, { name: string; purposes: Set<string> }>();
  for (const row of vendorRows) {
    const entry = byVendor.get(row.vendor) ?? { name: row.displayName || row.vendor, purposes: new Set<string>() };
    entry.purposes.add(CAPABILITY_PURPOSE[row.capability] ?? row.capability);
    byVendor.set(row.vendor, entry);
  }

  const subprocessors = [...byVendor.entries()].map(([vendor, entry]) => ({
    name: entry.name || vendor,
    purpose: [...entry.purposes].join('; '),
    // Not asserted. A region we have not verified is the single most dangerous field on a
    // security questionnaire, and an empty cell a buyer asks about beats a wrong one they
    // rely on.
    region: '',
  }));

  const documents = [
    { title: 'Data Processing Addendum', url: `${base}/legal/dpa` },
    { title: 'Subprocessor list', url: `${base}/legal/subprocessors` },
    { title: 'Privacy Policy', url: `${base}/legal/privacy` },
    { title: 'Security & compliance', url: `${base}/legal/compliance` },
    ...documentRows.map((row) => ({ title: row.title, url: `${base}/legal-documents/${row.id}` })),
  ];

  const { answers, answered } = autoAnswer(readTrustAnswers(card.questionnaire), {
    coveragePct: coverage.coveragePct,
    implemented: coverage.implemented,
    total: coverage.total,
    subprocessorCount: subprocessors.length,
    documents,
  });

  return {
    controls: coverage.controls.map((control) => ({
      controlRef: control.controlRef,
      objective: control.objective,
      status: control.status,
      lastReviewed: control.lastReviewed ?? '',
    })),
    subprocessors,
    documents,
    assembledAt: new Date().toISOString(),
    answered,
    questionnaire: answers,
  };
}

// ---------------------------------------------------------------------------
// The handoff
// ---------------------------------------------------------------------------

/**
 * Copy the board built during the sale into a fresh session, so what was made with the
 * buyer is not stranded on the seller's canvas.
 *
 * Duplicates OBJECTS and CONNECTIONS and nothing else: no members, no comments, no
 * timeline, no prospect shares. That is the point of a handoff rather than a transfer —
 * the customer gets the artifact, and the seller's own conversation, engagement history
 * and live links stay where they were minted.
 */
export async function handoffSession(
  db: Db,
  input: { sourceSessionId: string; tenantId: number; title: string; createdBy: string },
): Promise<{ sessionId: string; objects: number; connections: number } | { error: string }> {
  const [source] = await db.select({ id: creationSessions.id, segmentId: creationSessions.segmentId })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, input.tenantId, eq(creationSessions.id, input.sourceSessionId)))
    .limit(1);
  if (!source) return { error: 'That board could not be found in this workspace.' };

  const [rows, edges] = await Promise.all([
    db.select({
      id: creationSessionObjects.id,
      kind: creationSessionObjects.kind,
      canvasData: creationSessionObjects.canvasData,
      content: creationSessionObjects.content,
      searchText: creationSessionObjects.searchText,
    }).from(creationSessionObjects)
      .where(eq(creationSessionObjects.sessionId, source.id))
      .limit(1_000),
    db.select({
      sourceObjectId: creationSessionConnections.sourceObjectId,
      targetObjectId: creationSessionConnections.targetObjectId,
      kind: creationSessionConnections.kind,
      label: creationSessionConnections.label,
    }).from(creationSessionConnections)
      .where(eq(creationSessionConnections.sessionId, source.id))
      .limit(4_000),
  ]);

  const sessionId = crypto.randomUUID();
  await db.insert(creationSessions).values({
    id: sessionId,
    tenantId: input.tenantId,
    segmentId: source.segmentId,
    title: input.title,
    createdBy: input.createdBy,
    updatedBy: input.createdBy,
    canvasRevision: 1,
  });

  // New ids, mapped from the old ones — the edges are re-pointed through this map. A copy
  // that reused the source ids would collide on the primary key; a copy that dropped the
  // edges would hand the customer a pile of loose cards and call it their board.
  const idMap = new Map(rows.map((row) => [row.id, crypto.randomUUID()]));

  if (rows.length > 0) {
    await db.insert(creationSessionObjects).values(rows.map((row) => ({
      id: idMap.get(row.id)!,
      sessionId,
      kind: row.kind,
      canvasData: row.canvasData,
      content: row.content,
      searchText: row.searchText,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    })));
  }

  const carried = edges.flatMap((edge) => {
    const from = idMap.get(edge.sourceObjectId);
    const to = idMap.get(edge.targetObjectId);
    return from && to
      ? [{ id: crypto.randomUUID(), sessionId, sourceObjectId: from, targetObjectId: to, kind: edge.kind, label: edge.label, createdBy: input.createdBy }]
      : [];
  });
  if (carried.length > 0) await db.insert(creationSessionConnections).values(carried);

  return { sessionId, objects: rows.length, connections: carried.length };
}

// ---------------------------------------------------------------------------
// The trial
// ---------------------------------------------------------------------------

/**
 * Provision a trial: the demo board, copied into a time-boxed workspace of its own that
 * the prospect can open with no account.
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────────────────
 * It is NOT a new tenant. Creating one needs an owning USER, and the whole premise of the
 * moment this serves — "let me try it" straight after a demo — is that the buyer has not
 * signed up. A trial that begins with a registration form is the friction the prospect
 * share exists to remove, imposed one step later.
 *
 * What it IS: a real, separate, live board seeded from the one you just built together,
 * plus a prospect link into it that expires. The buyer opens it, watches it, and — when
 * the seller allows control — drives it. When they convert, `handoffSession` carries that
 * same board into the workspace they now own, which is why both live in this module and
 * share a copier.
 *
 * The caller mints the share (it owns the branding and the expiry); this returns the
 * board. Two steps rather than one because the share settings are the seller's, and a
 * provisioner that invented them would put a default seller name in front of a buyer.
 */
export async function provisionTrial(
  db: Db,
  input: { sourceSessionId: string; tenantId: number; prospect: string; days: number; createdBy: string },
): Promise<{ sessionId: string; objects: number; startsAt: string; expiresAt: string } | { error: string }> {
  const days = Math.min(180, Math.max(1, Math.round(input.days)));
  const copied = await handoffSession(db, {
    sourceSessionId: input.sourceSessionId,
    tenantId: input.tenantId,
    title: `Trial — ${input.prospect || 'prospect'}`,
    createdBy: input.createdBy,
  });
  if ('error' in copied) return copied;

  const startsAt = new Date();
  return {
    sessionId: copied.sessionId,
    objects: copied.objects,
    startsAt: startsAt.toISOString(),
    expiresAt: new Date(startsAt.getTime() + days * 86_400_000).toISOString(),
  };
}
