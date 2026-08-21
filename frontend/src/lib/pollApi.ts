/**
 * THE client for the facilitation surfaces — both ends of a live poll.
 *
 * ── WHY NOT `founderOpsApi.ts` ───────────────────────────────────────────────
 * That module's own header argues for one client over six, and it is right about the
 * surfaces it covers: collection, signature, payables, pipeline, investor update are one
 * bounded context (what a founder's operations produce) differing only in path and shape.
 * Facilitation is a different context with a different owner — it is what happens in a
 * ROOM — and its participant half is loaded by a phone that has no reason to pull an
 * invoice client with it. Same reasoning that keeps the vocabularies apart on the board.
 *
 * ── THE PARTICIPANT'S HALF IS HERE TOO, DELIBERATELY ─────────────────────────
 * `publicPoll` / `castVote` reach endpoints that carry no session, and they live beside
 * the calls they are the other end of. Splitting a module by authentication is how the
 * request shape and the response shape come to be maintained in two files.
 */

import { apiRequest } from '@/lib/apiClient';
import type { FormStatus, PollFormat, PollOption, PollTally, PublishedPoll } from '@builderforce/creation-canvas-contract';

export interface PublishPollBody {
  /** Present when re-publishing an edited poll — keeps the address already on screen. */
  questionSetId?: string;
  title: string;
  prompt?: string | null;
  format: PollFormat;
  options?: PollOption[];
  scaleMax?: number | null;
  gridXLabel?: string | null;
  gridYLabel?: string | null;
  anonymous?: boolean;
  showResultsLive?: boolean;
  closesAt?: string | null;
  /** The canvas object this poll is the projection of. */
  objectId?: string | null;
}

export interface PublishPollResult {
  questionSetId: string;
  slug: string;
  status: FormStatus;
}

export const publishPoll = (body: PublishPollBody) =>
  apiRequest<PublishPollResult>('/api/polls/publish', { method: 'POST', body: JSON.stringify(body) });

/** Steer a live poll. Open/close voting and show/hide the count are ONE write and two
 *  buttons — hiding the count while voting continues is the move that makes the
 *  instrument honest, so they are never pressed together. */
export const setPollState = (questionSetId: string, state: { status?: 'open' | 'closed'; showResultsLive?: boolean }) =>
  apiRequest<{ status: FormStatus; showResultsLive: boolean }>(
    `/api/polls/${encodeURIComponent(questionSetId)}/state`,
    { method: 'POST', body: JSON.stringify(state) },
  );

export interface FacilitatorPollView {
  poll: PublishedPoll;
  questionSetId: string;
  tally: PollTally;
  responseCount: number;
}

/** What the facilitator's board draws. The quiz answers ARE visible here — the person
 *  running the room is the person who wrote them. */
export const facilitatorPoll = (questionSetId: string) =>
  apiRequest<FacilitatorPollView>(`/api/polls/${encodeURIComponent(questionSetId)}`);

export interface ParticipantPollView {
  poll: PublishedPoll;
  tally: PollTally;
  /** Whether the facilitator is showing the room the count. The SERVER decides this and
   *  sends an empty tally when it is false — a payload carrying a hidden count is a
   *  hidden count in name only. */
  resultsVisible: boolean;
}

/** The participant's read. No session — the slug is the credential. */
export const publicPoll = (slug: string) =>
  apiRequest<ParticipantPollView>(`/api/public/polls/${encodeURIComponent(slug)}`);

export const castVote = (slug: string, submissionId: string, answer: unknown) =>
  apiRequest<{ ok: true; tally: PollTally; resultsVisible: boolean }>(
    `/api/public/polls/${encodeURIComponent(slug)}/vote`,
    { method: 'POST', body: JSON.stringify({ submissionId, answer }) },
  );

/**
 * This DEVICE's participant id.
 *
 * The whole of one-vote-per-participant, and deliberately nothing more: it is a random
 * id this browser keeps, sent with every vote so that re-voting REPLACES the previous
 * answer. A person may change their mind; nobody's identity is stored to make that
 * possible.
 *
 * It is honest about its limit — clearing storage or opening another browser gets you
 * another vote. The alternative is a device fingerprint, which is a column somebody
 * eventually joins, and the promise an anonymous poll makes is that there is nothing to
 * join. A ballot box in a room works the same way.
 *
 * Keyed per poll so one device's vote in this morning's retro is not the same row as its
 * vote in this afternoon's estimate.
 */
export function participantId(slug: string): string {
  const key = `builderforce.poll.participant.${slug}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const minted = crypto.randomUUID();
    window.localStorage.setItem(key, minted);
    return minted;
  } catch {
    // Private mode, a blocked origin, a storage quota. A participant who cannot be
    // remembered still gets to vote — they simply cannot change their answer, which is
    // a smaller loss than being unable to answer at all.
    return crypto.randomUUID();
  }
}
