/**
 * The résumé REVIEW QUEUE — somebody asks for feedback, somebody answers, the thread
 * continues.
 *
 * ── ZERO NEW TABLES, AND THE REASON IS NOT THRIFT ────────────────────────────────
 * A review request is a conversation with a status and an attachment. The kernel already
 * models exactly that (PRD 20 §2.1): `threads` + `messages`, presence in `memberships`,
 * containment in `objects` — the same four tables the direct-message hub runs on. A
 * `resume_review_requests` / `resume_review_messages` pair would be the second threading
 * implementation in this repo, and the two would agree right up until one of them forgot
 * to bump `message_count` or invented a second read-cursor column.
 *
 * So this service adds no table and no migration. What it adds is a KIND (`'review'`) and
 * a vocabulary for the message `parts` — which is what PRD 20 §6.2 means by "adding a kind
 * adds a value, not a table". The shared mechanics live in `messaging/kernelThreads.ts`;
 * this file owns only what is genuinely résumé-specific: what a request carries, what a
 * status means, and the fact that one of the reviewers can be the model.
 *
 * ── WHY THE DOCUMENT LIVES IN THE FIRST MESSAGE ──────────────────────────────────
 * A review is ABOUT a specific version of a document, and the version has to be frozen
 * at the moment the question was asked — otherwise a reviewer answers about a paragraph
 * the person edited an hour later, and the transcript reads as nonsense. Storing the text
 * (and the deterministic score at that moment) in the opening message's `parts` makes the
 * thread self-contained and immutable in exactly the way an audit of "what did you
 * actually review?" requires.
 *
 * ── THE MODEL IS A PARTICIPANT, NOT A REPLACEMENT ────────────────────────────────
 * `requestModelReview` posts the graded read into the SAME thread, as an `assistant`
 * message from an agent author. A human reviewer can then disagree with it in the next
 * message, and the disagreement is part of the record. That is the whole reason this is a
 * thread rather than a report: a review that cannot be argued with is a verdict.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  addThreadMembers, appendKernelMessage, getKernelThread, listKernelMessages, listKernelThreads,
  markKernelThreadRead, openKernelThread, setKernelThreadStatus, tenantThreadIds, threadObjectId,
} from '../messaging/kernelThreads';
import { notify } from '../notifications/notify';
import { scoreResume } from './resumeAnalysis';
import { ResumeAiService } from './resumeAi';
import type { ResumeGrade } from './resumeAiPrompts';

/** The `threads.kind` a résumé review is filed under. */
export const RESUME_REVIEW_THREAD_KIND = 'review';

/**
 * The states a reviewer can move a request through.
 *
 * Four, not two, because "somebody is looking at this" is the state a queue exists to
 * make visible — an open request nobody has claimed and an open request being read right
 * now are the same row to a database and completely different rows to a person deciding
 * what to pick up.
 */
export const RESUME_REVIEW_STATUSES = ['open', 'in_review', 'answered', 'closed'] as const;
export type ResumeReviewStatus = (typeof RESUME_REVIEW_STATUSES)[number];

export function isResumeReviewStatus(value: unknown): value is ResumeReviewStatus {
  return typeof value === 'string' && (RESUME_REVIEW_STATUSES as readonly string[]).includes(value);
}

const QUEUE_PAGE = 60;
const MESSAGES_PAGE = 200;
const MAX_BODY = 6000;
const MAX_RESUME = 40_000;
const MIN_RESUME = 40;

/** The structured payload on the OPENING message — the frozen document under review. */
interface ReviewRequestParts {
  kind: 'resume_review_request';
  resumeText: string;
  jobDescription: string;
  /** The deterministic score AT THE MOMENT OF ASKING, so drift is visible later. */
  measuredScore: number;
}

/** The structured payload on a model-authored review message. */
interface ReviewGradeParts {
  kind: 'resume_review_grade';
  grade: ResumeGrade;
  model: string | null;
  degraded: boolean;
}

export interface ResumeReviewMessage {
  id: number;
  authorKind: string;
  authorRef: string | null;
  role: string;
  body: string;
  createdAtISO: string;
  /** Present only on the model's own messages — the structured grade behind the prose. */
  grade: ResumeGrade | null;
  mine: boolean;
}

export interface ResumeReviewSummary {
  id: string;
  title: string;
  status: ResumeReviewStatus;
  lastMessageAtISO: string | null;
  messageCount: number;
  /** Messages by somebody else since this reader's cursor. A request they have never
   *  opened is entirely unread, which is precisely what a queue is telling them. */
  unread: number;
  participants: string[];
}

export interface ResumeReviewThread extends ResumeReviewSummary {
  resumeText: string;
  jobDescription: string;
  measuredScoreAtRequest: number;
  messages: ResumeReviewMessage[];
}

export interface OpenReviewInput {
  title: string;
  resumeText: string;
  jobDescription?: string;
  /** The question being asked. A review request with no question gets a default one. */
  note?: string;
  /** People to put on the thread immediately — a named reviewer rather than the queue. */
  reviewerUserIds?: readonly string[];
}

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * The queue, for one workspace.
 *
 * Every read names its tenant. A review request is workspace-owned: the person who asked
 * and the people who might answer are colleagues, and a request visible across workspaces
 * would be somebody's unpublished résumé on a stranger's screen.
 */
export class ResumeReviewService {
  constructor(private readonly db: Db, private readonly env: Env) {}

  /** Open a request. The document is frozen into the first message; see the header. */
  async open(tenantId: number, userId: string, input: OpenReviewInput): Promise<ResumeReviewThread | null> {
    const resumeText = clean(input.resumeText, MAX_RESUME);
    if (resumeText.length < MIN_RESUME) return null;
    const title = clean(input.title, 200) || 'Résumé review';
    const jobDescription = clean(input.jobDescription, MAX_RESUME);

    const reviewers = [...new Set((input.reviewerUserIds ?? []).map((id) => clean(id, 64)).filter((id) => id && id !== userId))];
    const opened = await openKernelThread(this.db, {
      tenantId,
      kind: RESUME_REVIEW_THREAD_KIND,
      title,
      domain: 'hiring',
      objectTitle: title,
      status: 'open',
      createdBy: userId,
      members: [
        { memberKind: 'user', memberRef: userId, role: 'owner' },
        ...reviewers.map((memberRef) => ({ memberKind: 'user' as const, memberRef, role: 'reviewer' })),
      ],
    });
    if (!opened) return null;

    const parts: ReviewRequestParts = {
      kind: 'resume_review_request',
      resumeText,
      jobDescription,
      measuredScore: scoreResume(resumeText).overall,
    };
    await appendKernelMessage(this.db, {
      tenantId,
      threadId: opened.threadId,
      authorKind: 'user',
      authorRef: userId,
      role: 'user',
      body: clean(input.note, MAX_BODY) || 'Please review this résumé.',
      parts,
    });
    await markKernelThreadRead(this.db, [tenantId], opened.threadId, userId);

    await Promise.all(reviewers.map((reviewer) => notify(this.db, this.env, {
      userId: reviewer,
      tenantId,
      kind: 'career.review_requested',
      title: 'A résumé review was requested',
      body: title,
      ref: `/career?tab=reviews&thread=${opened.threadId}`,
    })));

    return this.thread(tenantId, userId, opened.threadId);
  }

  /** The queue: every review request in this workspace, most recently spoken in first. */
  async queue(tenantId: number, userId: string, status?: ResumeReviewStatus): Promise<ResumeReviewSummary[]> {
    const ids = await tenantThreadIds(this.db, tenantId, RESUME_REVIEW_THREAD_KIND, QUEUE_PAGE);
    if (ids.length === 0) return [];
    const views = await listKernelThreads(this.db, {
      tenantIds: [tenantId], threadIds: ids, readerRef: userId,
      limit: QUEUE_PAGE, kind: RESUME_REVIEW_THREAD_KIND,
    });
    return views
      .map((view) => ({
        id: view.id,
        title: view.title,
        status: isResumeReviewStatus(view.status) ? view.status : 'open',
        lastMessageAtISO: view.lastMessageAtISO,
        messageCount: view.messageCount,
        unread: view.unread,
        participants: view.members.filter((member) => member.memberKind === 'user').map((member) => member.memberRef),
      }))
      .filter((summary) => !status || summary.status === status);
  }

  /** One request in full — the frozen document, the status and the whole transcript. */
  async thread(tenantId: number, userId: string, threadId: string): Promise<ResumeReviewThread | null> {
    const thread = await getKernelThread(this.db, [tenantId], threadId);
    if (!thread || thread.kind !== RESUME_REVIEW_THREAD_KIND) return null;

    const [rows, views] = await Promise.all([
      listKernelMessages(this.db, [tenantId], threadId, MESSAGES_PAGE),
      listKernelThreads(this.db, {
        tenantIds: [tenantId], threadIds: [threadId], readerRef: userId,
        limit: 1, kind: RESUME_REVIEW_THREAD_KIND,
      }),
    ]);
    const view = views[0];
    const request = rows.map((row) => readRequestParts(row.parts)).find(Boolean) ?? null;

    return {
      id: thread.id,
      title: thread.title,
      status: isResumeReviewStatus(thread.status) ? thread.status : 'open',
      lastMessageAtISO: view?.lastMessageAtISO ?? null,
      messageCount: view?.messageCount ?? rows.length,
      unread: view?.unread ?? 0,
      participants: (view?.members ?? []).filter((member) => member.memberKind === 'user').map((member) => member.memberRef),
      resumeText: request?.resumeText ?? '',
      jobDescription: request?.jobDescription ?? '',
      measuredScoreAtRequest: request?.measuredScore ?? 0,
      messages: rows.map((row) => ({
        id: row.id,
        authorKind: row.authorKind,
        authorRef: row.authorRef,
        role: row.role,
        body: row.body,
        createdAtISO: row.createdAtISO,
        grade: readGradeParts(row.parts)?.grade ?? null,
        mine: row.authorRef === userId,
      })),
    };
  }

  /**
   * Answer — the reply that makes this a thread rather than a form.
   *
   * Answering JOINS the thread. That is not a convenience: without a membership row the
   * responder has no read cursor, so every subsequent message in a conversation they are
   * now part of would count as unread forever.
   */
  async reply(
    tenantId: number,
    userId: string,
    threadId: string,
    body: string,
    status?: ResumeReviewStatus,
  ): Promise<ResumeReviewThread | null> {
    const text = clean(body, MAX_BODY);
    if (!text) return null;
    const thread = await getKernelThread(this.db, [tenantId], threadId);
    if (!thread || thread.kind !== RESUME_REVIEW_THREAD_KIND) return null;

    const objectId = await threadObjectId(this.db, [tenantId], threadId);
    if (objectId) await addThreadMembers(this.db, tenantId, objectId, [{ memberKind: 'user', memberRef: userId, role: 'reviewer' }]);

    await appendKernelMessage(this.db, {
      tenantId, threadId, authorKind: 'user', authorRef: userId, role: 'user', body: text,
    });
    if (status) await setKernelThreadStatus(this.db, tenantId, threadId, status);
    await markKernelThreadRead(this.db, [tenantId], threadId, userId);

    return this.thread(tenantId, userId, threadId);
  }

  /** Move the status without saying anything — claiming a request, or closing it out. */
  async setStatus(tenantId: number, userId: string, threadId: string, status: ResumeReviewStatus): Promise<ResumeReviewThread | null> {
    const thread = await getKernelThread(this.db, [tenantId], threadId);
    if (!thread || thread.kind !== RESUME_REVIEW_THREAD_KIND) return null;
    await setKernelThreadStatus(this.db, tenantId, threadId, status);
    return this.thread(tenantId, userId, threadId);
  }

  /**
   * Ask the model for its review, into the thread.
   *
   * It grades the FROZEN document from the opening message rather than anything the
   * caller passes in, so the model and every human reviewer are demonstrably reading the
   * same words. Its answer lands as one more message a person can argue with.
   */
  async requestModelReview(tenantId: number, userId: string, threadId: string): Promise<ResumeReviewThread | null> {
    const current = await this.thread(tenantId, userId, threadId);
    if (!current || !current.resumeText) return null;

    const outcome = await new ResumeAiService(this.env).gradeResume(
      tenantId,
      current.resumeText,
      current.jobDescription || undefined,
      { userId },
    );
    const parts: ReviewGradeParts = {
      kind: 'resume_review_grade',
      grade: outcome.grade,
      model: outcome.model,
      degraded: outcome.degraded,
    };
    await appendKernelMessage(this.db, {
      tenantId,
      threadId,
      authorKind: 'agent',
      authorRef: 'recruiter',
      role: 'assistant',
      body: modelReviewBody(outcome.grade, outcome.degraded, outcome.degradedReason),
      parts,
    });
    if (current.status === 'open') await setKernelThreadStatus(this.db, tenantId, threadId, 'in_review');

    return this.thread(tenantId, userId, threadId);
  }

  /** Move this reader's cursor to now. */
  async markRead(tenantId: number, userId: string, threadId: string): Promise<boolean> {
    return markKernelThreadRead(this.db, [tenantId], threadId, userId);
  }
}

/** The prose the model's message carries — the numbers, then the named gaps. */
function modelReviewBody(grade: ResumeGrade, degraded: boolean, degradedReason?: string): string {
  if (degraded) {
    return `${degradedReason ?? 'The model was unavailable.'} The measured reading still stands: ${grade.measured.overall}/100 overall. ${grade.measured.weaknesses[0] ?? ''}`.trim();
  }
  const gaps = grade.categories
    .flatMap((category) => category.gaps.map((gap) => `- ${category.label}: ${gap.gap}`))
    .slice(0, 10);
  return [
    grade.verdict,
    ...(gaps.length ? ['', 'Named gaps:', ...gaps] : []),
    ...(grade.disagreements.length ? ['', 'Where the two readings disagree:', ...grade.disagreements.map((line) => `- ${line}`)] : []),
  ].join('\n');
}

function readRequestParts(parts: unknown): ReviewRequestParts | null {
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return null;
  const record = parts as Record<string, unknown>;
  if (record.kind !== 'resume_review_request') return null;
  return {
    kind: 'resume_review_request',
    resumeText: typeof record.resumeText === 'string' ? record.resumeText : '',
    jobDescription: typeof record.jobDescription === 'string' ? record.jobDescription : '',
    measuredScore: typeof record.measuredScore === 'number' ? record.measuredScore : 0,
  };
}

function readGradeParts(parts: unknown): ReviewGradeParts | null {
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return null;
  const record = parts as Record<string, unknown>;
  if (record.kind !== 'resume_review_grade' || !record.grade) return null;
  return {
    kind: 'resume_review_grade',
    grade: record.grade as ResumeGrade,
    model: typeof record.model === 'string' ? record.model : null,
    degraded: record.degraded === true,
  };
}
