/**
 * What a learner's own copy of the work IS — the pure half, with no IO.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────
 * `bridgeLaunch` refused every `learn` launch and told the student "your
 * instructor distributes your own copy of the work". That destination did not
 * exist. `assignment.distribute` is a canvas action that adds one `submission`
 * object per roster row TO THE COHORT BOARD — the board a learner must never
 * open, because it carries the whole roster and every mark on it. So the honest
 * sentence pointed at nothing.
 *
 * A learner's board is therefore MINTED from what distribute already wrote: the
 * assignment, and the one submission that names them. This module owns the two
 * decisions that has to get right, and owns them here — pure, testable, with no
 * database — because both are about MEANING and neither is about storage.
 *
 * ── DECISION 1 · WHICH SUBMISSION IS THEIRS ──────────────────────────────────
 * The join is on NORMALISED REFS, not on ids. `distribute` writes
 * `{ learnerRef, assignmentRef }` onto each submission, where `assignmentRef` is
 * the assignment's TITLE and `learnerRef` is the roster row's `ref` (the platform
 * `sub`). The canvas compares those through `specRefKey`, and if this side
 * compared them any other way — case-sensitively, or without collapsing runs of
 * whitespace — a learner whose roster row says `S1234567 ` would launch into a
 * board that says nothing was distributed to them.
 *
 * `learnerRefKey` is that normalisation, mirrored EXACTLY:
 * `frontend/src/lib/specObjects.ts` → `specRefKey`. It is duplicated rather than
 * imported because `specRefKey` does not live in
 * `@builderforce/creation-canvas-contract` — the package both sides already
 * share — and lifting it there is a change to the canvas's own vocabulary
 * module. If it ever moves into that package, DELETE the body here and re-export
 * it; the two definitions existing is the drift this comment exists to make
 * visible, and the clamp below is the only intentional difference.
 *
 * ── DECISION 2 · WHAT MAY BE COPIED ONTO IT ──────────────────────────────────
 * The learner's board gets the brief and their own submission. It does NOT get:
 *
 *   · the cohort object      — that IS the roster, and the roster is everyone.
 *   · anyone else's work     — the caller selects one submission; these
 *                              functions never widen that.
 *   · the marking fields     — `placements`, `mark`, `markBreakdown`, `feedback`.
 *     A mark reaches a learner through the LMS gradebook, which is the ONLY
 *     surface that knows whether the module lead has released it. Marks are
 *     entered over two weeks and released once; copying a provisional mark onto
 *     a board the learner can open at any moment publishes it early, and there
 *     is no way to un-publish it. `submission.mark`'s `released` flag exists for
 *     exactly this, and it governs AGS — not a board copy.
 *   · the AGS line item      — `ltiLineItemUrl` on the assignment is the URL a
 *     score is POSTed to. On a staff board it is how marking syncs; on a
 *     learner's board it is a grade-write endpoint sitting in the browser of the
 *     person being graded.
 */

/** The column budget for a normalised ref (`lti_learner_boards.assignment_ref` /
 *  `learner_ref`, both varchar(160)). A longer value is clamped on BOTH sides of
 *  the join — a stored key and a lookup key go through this same function — so a
 *  very long title still matches itself. */
export const REF_KEY_MAX_LENGTH = 160;

/**
 * The comparable form of a reference.
 *
 * Mirrors `specRefKey` in `frontend/src/lib/specObjects.ts` — same trim, same
 * lower-casing, same whitespace collapse — with the column clamp appended. See
 * the header for why it is mirrored rather than imported.
 */
export function learnerRefKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, REF_KEY_MAX_LENGTH);
}

/** A `submission` object as it sits on the cohort board, reduced to what the
 *  decisions below read. `content` is the canvas object's JSON. */
export interface DistributedSubmission {
  objectId: string;
  content: Readonly<Record<string, unknown>>;
}

/**
 * Is this submission the one distributed to THIS learner for THIS assignment?
 *
 * Both refs must match. Matching on the learner alone would hand somebody the
 * wrong assignment's board when a course sets two; matching on the assignment
 * alone would hand them a classmate's work, which is the failure this whole
 * module exists to make impossible.
 */
export function isLearnerSubmission(
  content: Readonly<Record<string, unknown>>,
  assignmentKey: string,
  learnerKey: string,
): boolean {
  if (!assignmentKey || !learnerKey) return false;
  return learnerRefKey(content.assignmentRef) === assignmentKey
    && learnerRefKey(content.learnerRef) === learnerKey;
}

/**
 * Pick the one submission that belongs to this learner.
 *
 * Returns null when the assignment has not been distributed to them — which is a
 * legitimate, common state (the instructor has not run `distribute` yet, or the
 * roster grew after they did) and NOT an error. The caller turns it into a
 * sentence that says so.
 */
export function findLearnerSubmission(
  submissions: readonly DistributedSubmission[],
  assignmentKey: string,
  learnerKey: string,
): DistributedSubmission | null {
  return submissions.find((row) => isLearnerSubmission(row.content, assignmentKey, learnerKey)) ?? null;
}

/** The submission fields a marker writes. Stripped from the learner's copy — see
 *  the header. Exported so a test can assert the list rather than re-type it. */
export const MARKING_FIELDS = ['placements', 'mark', 'markBreakdown', 'feedback'] as const;

/** The assignment fields that are a STAFF capability, not a brief. */
export const STAFF_ONLY_ASSIGNMENT_FIELDS = ['ltiLineItemUrl'] as const;

function without(
  content: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> {
  const drop = new Set<string>(fields);
  return Object.fromEntries(Object.entries(content).filter(([key]) => !drop.has(key)));
}

/**
 * The learner's copy of their submission.
 *
 * Keeps the substance — what was asked, what they handed in, their declaration,
 * the authorship ledger — and drops the marking. `status` is deliberately kept:
 * "submitted" / "notSubmitted" is a fact about their own action.
 */
export function learnerSubmissionCopy(content: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return without(content, MARKING_FIELDS);
}

/** The learner's copy of the brief. */
export function learnerAssignmentCopy(content: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return without(content, STAFF_ONLY_ASSIGNMENT_FIELDS);
}

/**
 * What the learner's board is called.
 *
 * Titled after the WORK and not after the learner: it appears in their own
 * workspace list beside their other boards, where "Essay 1 — Introduction to
 * Physics" locates it and their own name does not.
 */
export function learnerBoardTitle(assignmentTitle: string, courseTitle: string): string {
  const work = assignmentTitle.trim() || 'Assignment';
  const course = courseTitle.trim();
  return (course ? `${work} — ${course}` : work).slice(0, 255);
}
