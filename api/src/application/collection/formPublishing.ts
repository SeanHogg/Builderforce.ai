/**
 * THE collection primitive, implemented — publish a question set, and take an
 * answer back from a human who is not in the workspace.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `packages/creation-canvas-contract/src/people.ts` declares `PublishedForm`,
 * `FORM_FIELD_TYPES`, `FORM_AUDIENCES`, `FORM_STATUSES` and an `anonymous`
 * boolean, argued distinction by distinction, and a grep across `api/src`,
 * `frontend/src`, `clients` and `packages` found ZERO consumers of any of them.
 * The contract called `form` "the single largest 'idea to REAL' break the canvas
 * had: it could author anything and collect nothing, so every flow that needed an
 * answer from a person terminated in a document and finished its real work
 * somewhere else". That was accurate.
 *
 * ── WHY NO NEW STORE ─────────────────────────────────────────────────────────
 * `question_sets` and `responses` in the kernel already absorbed twelve survey
 * tables and thirteen answer tables. The missing half was never the store — it
 * was the PUBLICATION: no public address, no anonymity switch, no enforceable
 * audience. Those are five columns (migration 0469) plus `form_recipients` for
 * the credential the named audience needs. A `published_forms` table beside
 * `question_sets` would have been the third response store the contract's own
 * note warns about.
 *
 * ── THE LAYER ────────────────────────────────────────────────────────────────
 * Application layer: it takes a `Db` and returns values, and knows nothing about
 * Hono, sessions or status codes. The route translates. Every validation that
 * protects a real person is performed HERE — a closed form, a wrong audience, a
 * required question left blank — so a second caller cannot reach the store
 * through a path that forgot one.
 */

import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import {
  FORM_AUDIENCES,
  isFormFieldType,
  type FormAudience,
  type FormQuestion,
  type FormStatus,
  type PublishedForm,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { formRecipients, questionSets, responses } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { sha256Hex } from '../../domain/shared/hash';

/** The `question_sets.kind` a canvas `form` object projects to. A kind is a
 *  column value — see the table's own note. */
export const FORM_QUESTION_SET_KIND = 'form';

/** Slug alphabet: unambiguous lowercase. No `l`/`1`/`o`/`0`, because these are
 *  read aloud and typed by hand more often than they are clicked. */
const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SLUG_LENGTH = 12;

/** A response may not be larger than this. An unbounded JSON body from an
 *  unauthenticated surface is a denial-of-service with extra steps. */
const MAX_ANSWER_CHARS = 4000;
const MAX_QUESTIONS = 60;

export class FormError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'FormError';
  }
}

function mintSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LENGTH));
  return [...bytes].map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join('');
}

/**
 * Read a question set's declared questions back into the contract's shape.
 *
 * Defensive by construction: the column is JSONB, so it can hold anything an
 * older writer put there, and the responder route renders whatever comes out of
 * here to a stranger's browser. A question whose `type` is not one of the nine
 * declared ones is DROPPED rather than rendered as a text box — a control that
 * silently changes what it collects is worse than a question that is missing.
 */
export function readQuestions(raw: unknown): FormQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index): FormQuestion[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (!isFormFieldType(row.type)) return [];
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) return [];
    const options = Array.isArray(row.options)
      ? row.options.filter((o): o is string => typeof o === 'string').slice(0, 40)
      : undefined;
    // A select with no options renders a control nobody can answer, so it is a
    // malformed question rather than an empty one.
    if ((row.type === 'select' || row.type === 'multiSelect') && !options?.length) return [];
    return [{
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 120) : `q${index + 1}`,
      type: row.type,
      label: label.slice(0, 300),
      ...(typeof row.help === 'string' && row.help.trim() ? { help: row.help.trim().slice(0, 500) } : {}),
      ...(row.required === true ? { required: true } : {}),
      ...(options ? { options } : {}),
      ...(typeof row.max === 'number' && Number.isFinite(row.max) ? { max: Math.min(Math.max(Math.round(row.max), 2), 10) } : {}),
    }];
  }).slice(0, MAX_QUESTIONS);
}

function asFormStatus(value: string): FormStatus {
  return value === 'open' || value === 'closed' ? value : 'draft';
}

function asAudience(value: string): FormAudience {
  return (FORM_AUDIENCES as readonly string[]).includes(value) ? value as FormAudience : 'anyoneWithLink';
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface PublishFormInput {
  questionSetId?: string;
  title: string;
  description?: string | null;
  questions: unknown;
  anonymous?: boolean;
  audience?: string;
  closesAt?: string | null;
  confirmationMessage?: string | null;
  /** Canvas object this set projects, when it came from a board. */
  objectId?: string | null;
  /** Named audience only. Each gets its own credential; the plaintext token is
   *  returned ONCE, here, because it is never stored. */
  recipients?: Array<{ email: string; name?: string }>;
  createdBy?: string | null;
}

export interface PublishFormResult {
  questionSetId: string;
  slug: string;
  status: FormStatus;
  /** `{email, token}` for each named recipient — the only time the plaintext
   *  exists. The caller sends them; nothing here can read them again. */
  invitations: Array<{ email: string; name: string | null; token: string }>;
}

/**
 * Publish a set: mint its slug, open it, and issue a credential per named
 * recipient.
 *
 * Idempotent on the slug. Re-publishing an already-published set keeps the
 * address it had, because a slug that changed on every edit would break every
 * link already sent — which is the one failure a form cannot recover from.
 */
export async function publishForm(
  db: Db,
  tenantId: number,
  input: PublishFormInput,
): Promise<PublishFormResult> {
  const questions = readQuestions(input.questions);
  if (!questions.length) {
    throw new FormError('A form with no answerable questions collects nothing. Add at least one question of a declared type.', 400);
  }
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new FormError('A form needs a title — it is the first thing the responder reads.', 400);

  const audience = asAudience(String(input.audience ?? 'anyoneWithLink'));
  const recipients = (input.recipients ?? [])
    .map((r) => ({ email: r.email.trim().toLowerCase().slice(0, 320), name: r.name?.trim().slice(0, 200) ?? null }))
    .filter((r) => r.email.includes('@'));

  if (audience === 'namedRecipients' && !recipients.length) {
    throw new FormError('A named-recipient form with no recipients can never be answered. Add the people it is for, or choose a different audience.', 400);
  }

  const closesAt = input.closesAt ? new Date(input.closesAt) : null;
  if (closesAt && Number.isNaN(closesAt.getTime())) throw new FormError('closesAt is not a date.', 400);

  const shared = {
    kind: FORM_QUESTION_SET_KIND,
    name: title,
    description: input.description?.trim().slice(0, 2000) ?? null,
    questions,
    status: 'open',
    anonymous: input.anonymous === true,
    audienceKind: audience,
    confirmationMessage: input.confirmationMessage?.trim().slice(0, 1000) ?? null,
    closesAt,
    objectId: input.objectId ?? null,
    updatedAt: new Date(),
  } as const;

  let row: { id: string; slug: string | null } | undefined;
  if (input.questionSetId) {
    [row] = await db
      .update(questionSets)
      .set(shared)
      .where(scopedToTenant(questionSets, tenantId, eq(questionSets.id, input.questionSetId)))
      .returning({ id: questionSets.id, slug: questionSets.slug });
    if (!row) throw new FormError('That form does not exist in this workspace.', 404);
  } else {
    [row] = await db
      .insert(questionSets)
      .values({ tenantId, createdBy: input.createdBy ?? null, ...shared })
      .returning({ id: questionSets.id, slug: questionSets.slug });
  }
  if (!row) throw new FormError('The form could not be published.', 500);

  // Minted only if absent — see the idempotency note above.
  let slug = row.slug;
  if (!slug) {
    slug = mintSlug();
    await db
      .update(questionSets)
      .set({ slug })
      .where(scopedToTenant(questionSets, tenantId, eq(questionSets.id, row.id)));
  }

  const invitations: PublishFormResult['invitations'] = [];
  for (const recipient of recipients) {
    const token = crypto.randomUUID().replace(/-/g, '');
    const tokenHash = await sha256Hex(token);
    // `onConflictDoNothing` rather than an upsert: re-publishing must not rotate
    // a credential somebody is already holding, or the link in their inbox stops
    // working the moment the author fixes a typo in the title.
    const [inserted] = await db
      .insert(formRecipients)
      .values({ tenantId, questionSetId: row.id, email: recipient.email, name: recipient.name, tokenHash })
      .onConflictDoNothing({ target: [formRecipients.questionSetId, formRecipients.email] })
      .returning({ id: formRecipients.id });
    if (inserted) invitations.push({ email: recipient.email, name: recipient.name, token });
  }

  return { questionSetId: row.id, slug, status: 'open', invitations };
}

/** Close a form. Distinct from deleting it: the responses stay, and the address
 *  keeps resolving so a late responder is told it closed rather than 404'd. */
export async function closeForm(db: Db, tenantId: number, questionSetId: string): Promise<void> {
  const [row] = await db
    .update(questionSets)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(scopedToTenant(questionSets, tenantId, eq(questionSets.id, questionSetId)))
    .returning({ id: questionSets.id });
  if (!row) throw new FormError('That form does not exist in this workspace.', 404);
}

// ---------------------------------------------------------------------------
// The public half
// ---------------------------------------------------------------------------

/** What the responder route resolved, plus the tenant it belongs to — which the
 *  ROW reports rather than the caller asserting. */
export interface ResolvedForm {
  tenantId: number;
  questionSetId: string;
  form: PublishedForm;
  /** Set when the address carried a named-recipient credential. */
  recipient: { id: number; email: string; name: string | null; respondedAt: Date | null } | null;
}

/**
 * Resolve a public form address.
 *
 * A DECLARED cross-tenant read: a stranger's browser has no session and no
 * tenant, so the slug is the credential and the row reports whose it is. The
 * access predicate is the slug itself plus a published status, which is what
 * `acrossTenants` refuses to let a caller omit.
 *
 * Returns the CONTRACT's projection — no tenant, no session, no responses — which
 * is already the right shape to send to a browser outside the workspace.
 */
export async function resolvePublicForm(db: Db, slug: string, token?: string): Promise<ResolvedForm | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean || clean.length > 64) return null;

  const [row] = await db
    .select({
      id: questionSets.id,
      tenantId: questionSets.tenantId,
      name: questionSets.name,
      description: questionSets.description,
      questions: questionSets.questions,
      status: questionSets.status,
      anonymous: questionSets.anonymous,
      audienceKind: questionSets.audienceKind,
      closesAt: questionSets.closesAt,
      confirmationMessage: questionSets.confirmationMessage,
    })
    .from(questionSets)
    .where(acrossTenants(questionSets, 'share_token', eq(questionSets.slug, clean)))
    .limit(1);
  if (!row) return null;

  let recipient: ResolvedForm['recipient'] = null;
  if (token) {
    const tokenHash = await sha256Hex(token);
    const [found] = await db
      .select({
        id: formRecipients.id,
        email: formRecipients.email,
        name: formRecipients.name,
        respondedAt: formRecipients.respondedAt,
      })
      .from(formRecipients)
      .where(acrossTenants(
        formRecipients,
        'share_token',
        eq(formRecipients.tokenHash, tokenHash),
        eq(formRecipients.questionSetId, row.id),
      ))
      .limit(1);
    recipient = found ?? null;
  }

  // A form past its close date reads as CLOSED to the responder even if nobody
  // has run a sweep. The date is the promise; a sweep is an implementation
  // detail, and "closes Friday" must be true on Saturday without one.
  const expired = row.closesAt != null && row.closesAt.getTime() <= Date.now();
  const status: FormStatus = expired ? 'closed' : asFormStatus(row.status);

  return {
    tenantId: row.tenantId,
    questionSetId: row.id,
    recipient,
    form: {
      slug: clean,
      title: row.name,
      description: row.description,
      questions: readQuestions(row.questions),
      status,
      anonymous: row.anonymous,
      audience: asAudience(row.audienceKind),
      closesAt: row.closesAt ? row.closesAt.toISOString() : null,
      confirmationMessage: row.confirmationMessage,
    },
  };
}

export interface SubmitFormInput {
  /** Raw `{ [questionId]: value }` from the responder's browser. */
  answers: Record<string, unknown>;
  /** The signed-in responder, when the form is a workspace one. NEVER passed for
   *  an anonymous form — the caller does not get to decide that, the form does. */
  respondentRef?: string | null;
  /** What was true at the moment of submission, for the audit the caller keeps. */
  submittedAt?: Date;
}

/**
 * Accept one submission.
 *
 * Every rule that protects the promise the form made is enforced here:
 *
 *  · a draft or closed form takes nothing;
 *  · a `namedRecipients` form takes nothing without a resolved credential, and
 *    nothing twice from the same one;
 *  · a `workspace` form takes nothing from an anonymous caller;
 *  · a required question left blank is refused with its label, so the responder
 *    is told what is missing rather than that "something" is;
 *  · an ANONYMOUS form discards the respondent even when the caller supplied
 *    one. The caller is not trusted to honour that — the whole promise is that
 *    there is nothing to join, and a route that forgets is how it is broken.
 */
export async function submitFormResponse(
  db: Db,
  resolved: ResolvedForm,
  input: SubmitFormInput,
): Promise<{ submissionId: string; confirmationMessage: string | null }> {
  const { form } = resolved;
  if (form.status !== 'open') {
    throw new FormError(form.status === 'closed' ? 'This form is closed.' : 'This form is not accepting responses yet.', 409);
  }
  if (form.audience === 'namedRecipients') {
    if (!resolved.recipient) throw new FormError('This form is for named recipients. Use the personal link you were sent.', 403);
    if (resolved.recipient.respondedAt) throw new FormError('You have already answered this form.', 409);
  }
  if (form.audience === 'workspace' && !input.respondentRef) {
    throw new FormError('This form is for members of the workspace. Sign in to answer it.', 401);
  }

  const submittedAt = input.submittedAt ?? new Date();
  const submissionId = crypto.randomUUID();

  const rows = form.questions.map((question) => {
    const raw = input.answers[question.id];
    const missing = raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (question.required && missing) {
      throw new FormError(`"${question.label}" is required.`, 400);
    }
    return { question, raw, missing };
  }).filter((entry) => !entry.missing);

  if (!rows.length) throw new FormError('The submission is empty.', 400);

  // The anonymity decision belongs to the FORM, not to the caller. See the note.
  const respondentRef = form.anonymous ? null : (input.respondentRef ?? null);

  await db.insert(responses).values(rows.map(({ question, raw }) => ({
    tenantId: resolved.tenantId,
    questionSetId: resolved.questionSetId,
    submissionId,
    recipientId: form.anonymous ? null : resolved.recipient?.id ?? null,
    respondentKind: respondentRef ? 'user' : 'anonymous',
    respondentRef,
    questionKey: question.id,
    ...answerColumns(question, raw),
    submittedAt,
  })));

  // Marked even on an anonymous form: "has this person answered" and "what did
  // they answer" are different questions, and only the second one is a promise.
  // Without this a named anonymous survey could be answered forever from one link.
  if (resolved.recipient) {
    await db
      .update(formRecipients)
      .set({ respondedAt: submittedAt })
      // The tenant comes from the ROW the slug resolved to, never from a caller —
      // the responder has no session to assert one with.
      .where(scopedToTenant(formRecipients, resolved.tenantId, eq(formRecipients.id, resolved.recipient.id)));
  }

  return { submissionId, confirmationMessage: form.confirmationMessage };
}

/**
 * One answer → the right typed column.
 *
 * `responses` carries a column per type rather than one stringified value, and
 * the table's own note says why: a scorecard average and a pulse trend are
 * aggregates, and aggregating text that happens to look numeric is how a survey
 * reports a score of NaN. So the mapping is by DECLARED question type and never
 * by what the value looks like.
 */
function answerColumns(question: FormQuestion, raw: unknown): {
  valueText: string | null;
  valueNumber: string | null;
  valueJson: unknown;
} {
  switch (question.type) {
    case 'number':
    case 'scale': {
      const n = typeof raw === 'number' ? raw : Number(String(raw));
      return { valueText: null, valueNumber: Number.isFinite(n) ? String(n) : null, valueJson: null };
    }
    case 'boolean':
      // Stored as 1/0 so "what share said yes" is an average rather than a
      // string comparison every reader writes its own version of.
      return { valueText: null, valueNumber: raw === true || raw === 'true' ? '1' : '0', valueJson: null };
    case 'multiSelect': {
      const list = Array.isArray(raw) ? raw.map((v) => String(v).slice(0, 200)).slice(0, 40) : [];
      return { valueText: null, valueNumber: null, valueJson: list };
    }
    default:
      return { valueText: String(raw ?? '').slice(0, MAX_ANSWER_CHARS), valueNumber: null, valueJson: null };
  }
}

// ---------------------------------------------------------------------------
// Reading the answers back
// ---------------------------------------------------------------------------

export interface FormResponseSummary {
  questionSetId: string;
  slug: string | null;
  title: string;
  status: FormStatus;
  anonymous: boolean;
  audience: FormAudience;
  /** Distinct submissions — countable on an anonymous form because of
   *  `submission_id`, which is the whole reason that column exists. */
  submissionCount: number;
  /** Named audience only: how many were invited, and how many have answered.
   *  This is what a policy acknowledgement's `acknowledgementRate` is derived
   *  from rather than asserted. */
  invitedCount: number;
  respondedCount: number;
}

/**
 * The counters a form's card shows.
 *
 * Three aggregate queries rather than reading every response row and counting in
 * memory: a form with 40,000 answers is an ordinary outcome and loading them to
 * produce one integer is the unbounded-result-set anti-pattern.
 */
export async function summarizeForm(
  db: Db,
  tenantId: number,
  questionSetId: string,
): Promise<FormResponseSummary | null> {
  const [set] = await db
    .select({
      id: questionSets.id,
      slug: questionSets.slug,
      name: questionSets.name,
      status: questionSets.status,
      anonymous: questionSets.anonymous,
      audienceKind: questionSets.audienceKind,
    })
    .from(questionSets)
    .where(scopedToTenant(questionSets, tenantId, eq(questionSets.id, questionSetId)))
    .limit(1);
  if (!set) return null;

  const [[submissions], [invited], [responded]] = await Promise.all([
    db
      .select({ value: sql<number>`count(distinct ${responses.submissionId})` })
      .from(responses)
      .where(scopedToTenant(responses, tenantId, eq(responses.questionSetId, questionSetId))),
    db
      .select({ value: count() })
      .from(formRecipients)
      .where(scopedToTenant(formRecipients, tenantId, eq(formRecipients.questionSetId, questionSetId))),
    db
      .select({ value: count() })
      .from(formRecipients)
      .where(scopedToTenant(
        formRecipients,
        tenantId,
        and(eq(formRecipients.questionSetId, questionSetId), isNotNull(formRecipients.respondedAt)),
      )),
  ]);

  return {
    questionSetId: set.id,
    slug: set.slug,
    title: set.name,
    status: asFormStatus(set.status),
    anonymous: set.anonymous,
    audience: asAudience(set.audienceKind),
    submissionCount: Number(submissions?.value ?? 0),
    invitedCount: Number(invited?.value ?? 0),
    respondedCount: Number(responded?.value ?? 0),
  };
}
