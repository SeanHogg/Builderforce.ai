import { describe, it, expect } from 'vitest';
import {
  declinesReview,
  leftChangeUnreviewed,
  previewReviewDirective,
  ticketsReviewedInPreview,
  unreviewedChangeNudge,
} from './previewReview';
import { linkedTicketsReviewedComplete } from './chatWorkLinking';
import type { BrainTraceEvent } from './brainTriage';

let seq = 0;
function step(label: string, args: unknown, result: unknown = { ok: true }, isError = false): BrainTraceEvent {
  seq += 1;
  return { ts: new Date(seq * 1000).toISOString(), category: 'tool', label, args, result, isError };
}

const STUDIO_TOOLS = ['canvas_read_build_file', 'canvas_edit_build_file', 'canvas_read_build_diagnostics', 'canvas_inspect_preview', 'builtin_reviews_record', 'builtin_chats_list_tickets'];
const EDIT = () => step('canvas_edit_build_file', { path: 'src/index.css' }, { ok: true, applied: true, replacements: 1 });
const INSPECT = (passed: boolean) => step('canvas_inspect_preview', { selectors: ['.character-tag'] }, { ok: true, passed, viewports: [] });
const REVIEW = (taskId: number, verdict: 'complete' | 'gaps' = 'complete') =>
  step('builtin_reviews_record', { taskId, verdict, summary: '.character-tag 74×23px at 390px' }, { reviewId: 1, verdict, reviewCount: 1, gapTaskIds: [] });

describe('ticketsReviewedInPreview', () => {
  it('closes the measured case: edit, passing inspection, complete review', () => {
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), REVIEW(2761)])).toEqual([2761]);
  });

  it('closes every ticket reviewed complete after the passing inspection, once each', () => {
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), REVIEW(2761), REVIEW(2763), REVIEW(2761)])).toEqual([2761, 2763]);
  });

  it('closes nothing when the inspection failed', () => {
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(false), REVIEW(2761)])).toEqual([]);
  });

  it('closes nothing when the review came BEFORE the passing inspection', () => {
    expect(ticketsReviewedInPreview([EDIT(), REVIEW(2761), INSPECT(true)])).toEqual([]);
  });

  /** An inspection of the app before the last edit reviewed a different app. */
  it('closes nothing when the app changed again after the inspection', () => {
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), EDIT(), REVIEW(2761)])).toEqual([]);
  });

  it('re-opens the window once the latest change is inspected again', () => {
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), EDIT(), INSPECT(true), REVIEW(2761)])).toEqual([2761]);
  });

  it('closes nothing for a "gaps" verdict, even when the server read an omitted verdict as gaps', () => {
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), REVIEW(2761, 'gaps')])).toEqual([]);
    const omitted = step('builtin_reviews_record', { taskId: 2761 }, { reviewId: 2, verdict: 'gaps', reviewCount: 1, gapTaskIds: [9] });
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), omitted])).toEqual([]);
  });

  it('closes nothing when the review call failed', () => {
    const failed = step('builtin_reviews_record', { taskId: 2761, verdict: 'complete' }, { error: 'Task not found in workspace' }, true);
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), failed])).toEqual([]);
  });

  it('closes nothing in a run that changed nothing — a review alone is not a delivery', () => {
    expect(ticketsReviewedInPreview([INSPECT(true), REVIEW(2761)])).toEqual([]);
  });

  it('ignores a failed edit when finding the last change', () => {
    const failedEdit = step('canvas_edit_build_file', { path: 'src/App.jsx' }, { error: 'find did not match' }, true);
    expect(ticketsReviewedInPreview([EDIT(), INSPECT(true), failedEdit, REVIEW(2761)])).toEqual([2761]);
  });
});

describe('linkedTicketsReviewedComplete', () => {
  const listed = [
    { kind: 'task', ref: '2761', status: 'in_review', exists: true },
    { kind: 'task', ref: '2763', status: 'in_progress', exists: true },
    { kind: 'task', ref: '2764', status: 'in_review', exists: true },
    { kind: 'task', ref: '2765', status: 'done', exists: true },
  ];

  it('selects only the linked, still-open tickets this run reviewed', () => {
    expect(linkedTicketsReviewedComplete(listed, [2761, 2763, 2765]).map((t) => t.ref)).toEqual(['2761', '2763']);
  });

  it('never sweeps up a linked ticket that was not reviewed', () => {
    expect(linkedTicketsReviewedComplete(listed, [2761]).map((t) => t.ref)).toEqual(['2761']);
  });

  it('ignores a reviewed id that is not linked to this chat', () => {
    expect(linkedTicketsReviewedComplete(listed, [9999])).toEqual([]);
  });
});

describe('leftChangeUnreviewed', () => {
  const base = {
    codeChanged: true,
    toolNames: STUDIO_TOOLS,
    requestText: 'The mobile/responsive experience needs to be improved.',
    events: [EDIT()],
  };

  it('fires on the measured case: the app changed, nothing inspected, nothing reviewed', () => {
    expect(leftChangeUnreviewed(base)).toBe(true);
  });

  it('is quiet when the run changed nothing', () => {
    expect(leftChangeUnreviewed({ ...base, codeChanged: false })).toBe(false);
  });

  it('is quiet outside the Studio (no preview review tool)', () => {
    expect(leftChangeUnreviewed({ ...base, toolNames: ['read_file', 'edit_file', 'git_commit', 'git_push'] })).toBe(false);
  });

  it('still fires when the run inspected but never recorded a review', () => {
    expect(leftChangeUnreviewed({ ...base, events: [EDIT(), INSPECT(true)] })).toBe(true);
  });

  it('is quiet once an inspection and a review follow the last change — pass or gaps', () => {
    expect(leftChangeUnreviewed({ ...base, events: [EDIT(), INSPECT(true), REVIEW(2763)] })).toBe(false);
    expect(leftChangeUnreviewed({ ...base, events: [EDIT(), INSPECT(false), REVIEW(2763, 'gaps')] })).toBe(false);
  });

  it('fires again when the app changed after the review', () => {
    expect(leftChangeUnreviewed({ ...base, events: [EDIT(), INSPECT(true), REVIEW(2763), EDIT()] })).toBe(true);
  });

  it('is quiet when the user said not to review', () => {
    expect(leftChangeUnreviewed({ ...base, requestText: 'Fix the nav but do not close the ticket yet' })).toBe(false);
  });

  /** Chat #129's requests were defect reports, not imperatives — the edit is the evidence. */
  it('fires whatever the phrasing of the request — a defect report or a question the run answered with an edit', () => {
    expect(leftChangeUnreviewed({ ...base, requestText: 'The hero pill is incorrect; its height is wrong.' })).toBe(true);
    expect(leftChangeUnreviewed({ ...base, requestText: 'Why is the hero pill so tall?' })).toBe(true);
  });
});

describe('declinesReview', () => {
  it('reads only explicit refusals', () => {
    expect(declinesReview("don't review it, I'll check myself")).toBe(true);
    expect(declinesReview('leave the tickets open')).toBe(true);
    expect(declinesReview('Fix the hero pill height')).toBe(false);
    expect(declinesReview(null)).toBe(false);
  });
});

describe('the directive and the nudge', () => {
  it('names the tools the contract depends on, with the chat id', () => {
    const directive = previewReviewDirective(129);
    expect(directive).toContain('canvas_inspect_preview');
    expect(directive).toContain('canvas_read_build_diagnostics');
    expect(directive).toContain('builtin_reviews_record');
    expect(directive).toContain('builtin_chats_list_tickets with chatId=129');
  });

  it('tells a staffed chat the review is still this session\'s', () => {
    expect(previewReviewDirective(1)).toMatch(/even when agents are invited into this chat/);
  });

  it('nudges toward inspecting and recording, with an honest way out', () => {
    const nudge = unreviewedChangeNudge();
    expect(nudge).toContain('canvas_inspect_preview');
    expect(nudge).toContain('builtin_reviews_record');
    expect(nudge).toMatch(/cannot verify/);
  });
});
