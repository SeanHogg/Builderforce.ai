import { describe, it, expect } from 'vitest';
import {
  announcesUntakenAction,
  claimsMissingToolData,
  shouldRecoverStalledTurn,
  isExhaustedStall,
  isEmptyTurn,
  catalogToolNamesMentionedIn,
  stallRecoveryNudge,
  stallExhaustedNotice,
  modelFailoverNotice,
  toolNamesMentionedIn,
  MAX_ANNOUNCEMENT_RECOVERIES,
  MAX_MODEL_FAILOVERS,
} from './index';

/**
 * Guards the heuristic behind every agent loop's stall recovery. A false positive
 * costs one extra model turn; a false negative strands the user holding a promise.
 */
describe('announcesUntakenAction', () => {
  it('matches the reply that prompted this — a promise instead of a call', () => {
    expect(announcesUntakenAction(
      'I need the task status breakdown for project 11 before charting. Calling the tool now.',
    )).toBe(true);
  });

  it('matches the common stall phrasings', () => {
    const stalls = [
      'Let me fetch that for you.',
      "I'll query the tasks API and report back.",
      'I am going to look up the project data.',
      'One moment.',
      'Retrieving that now.',
      'Stand by.',
    ];
    for (const s of stalls) expect(announcesUntakenAction(s), s).toBe(true);
  });

  /**
   * Regression: the verb list used to be call/use/invoke/run/query/fetch/retrieve/
   * look up/pull/check/get, so EVERY line below scored false and the run loop
   * accepted the announcement as a final answer — the reported "the agent says it
   * will search and then just stops".
   */
  it('matches the stall verbs the narrow list missed', () => {
    const stalls = [
      "I'll search the codebase for the handler.",
      'Let me search for where that is wired.',
      "I'll review the tasks with successful PR builds. Let me start by looking at the pull requests.",
      'Let me look at a few more file-change sets.',
      'Let me find the coder and tester agents in the roster.',
      'Let me verify these 8 are the doc-only ones.',
      'Let me do that now.',
      'Let me first understand the pattern by examining a couple of these PRs. Let me examine them.',
      "I'll take a look at the migrations.",
      "Let's dig into the execution history.",
      "I'll go ahead and list the open pull requests.",
      'Searching for the failing spec now.',
    ];
    for (const s of stalls) expect(announcesUntakenAction(s), s).toBe(true);
  });

  it('does NOT match a complete answer that merely mentions checking something', () => {
    const answers = [
      'Let me know if you want a different chart type.',
      'The build failed because the token expired. Check the gateway logs for the 401.',
      'You can call the tasks API yourself with the ingest key.',
      'I do not have the task status data for project 11.',
    ];
    for (const a of answers) expect(announcesUntakenAction(a), a).toBe(false);
  });

  /**
   * The broadened verb list leans on the SUBJECT to discriminate: a first-person
   * commitment is a stall, the same verb aimed at the user is a finished answer.
   * These pin that boundary.
   */
  it('does NOT match an action the USER is being told to take', () => {
    const answers = [
      'Search the audit log for the revoked token to confirm the window.',
      'You should review PR #302 before merging — it only changes PRD.md.',
      'To reproduce, run the migration and then look at the 0297 table.',
      'The next step is to find the orphaned tickets and reassign them.',
      'Let me know once the coder agent finishes and I can verify the diff.',
    ];
    for (const a of answers) expect(announcesUntakenAction(a), a).toBe(false);
  });

  it('ignores a mid-answer aside — only the tail signs off with a promise', () => {
    const body = 'Let me check the numbers. '.padEnd(400, 'x');
    const complete = `${body}\n\n| Status | Count |\n| --- | --- |\n| Open | 12 |`;
    expect(announcesUntakenAction(complete)).toBe(false);
  });

  it('has no opinion on empty text', () => {
    expect(announcesUntakenAction('')).toBe(false);
    expect(announcesUntakenAction('   ')).toBe(false);
  });

  /**
   * Regression, measured on VS Code chat #85 (`xai-oauth/grok-4.3`). The subject-led
   * patterns caught turns 1-2 and recovered them; then the model dropped the narration
   * and wrote the bare call, which has NO first-person subject — so it scored as a
   * complete answer, the loop returned it as the reply, and the run ended having done
   * nothing. That is the reported "it doesn't execute, it just dies".
   */
  it('matches a bare PSEUDO-CALL with no first-person subject', () => {
    const pseudoCalls = [
      'run tool builtin_chats_list_tickets with chatId is 85',
      'call builtin_chats_list_tickets with chatId is 85',
      'invoke the function mcp__github__list_prs with owner and repo',
      'builtin_tasks_create({"title":"x"})',
      'call the tool builtin_projects_list',
      'mcp__brain__search with query "backlog"',
    ];
    for (const s of pseudoCalls) expect(announcesUntakenAction(s), s).toBe(true);
  });

  it('does NOT match an answer that merely NAMES a tool without invoking it', () => {
    const answers = [
      'The builtin_tasks_create tool creates a task on the board.',
      'builtin_chats_link_ticket: links an existing ticket to this chat.',
      'Two tools cover that: builtin_tasks_create and builtin_tasks_update.',
      'I could not find a builtin_reports_export tool in the catalog.',
    ];
    for (const a of answers) expect(announcesUntakenAction(a), a).toBe(false);
  });
});

/**
 * The stall that reads like an answer. Measured on the manager's accountability chat
 * (project 11, chat 86, 2026-07-28, `xai-oauth/grok-4.3`): 7 model turns, 0 tool calls,
 * and the replies below were shipped to the user verbatim because nothing in them
 * promises or invokes anything — they simply report that results are missing.
 */
describe('claimsMissingToolData', () => {
  it('matches the replies that prompted this — missing results it never asked for', () => {
    const stalls = [
      'The tools required are manager.digest, manager.decisions, manager.census and manager.policy. No other tools provide the needed data.',
      'The required tools have not returned results yet, so I have no new data on digest, decisions, census or policy for project 11.',
      'Little got done: no results from manager.digest, manager.decisions, manager.census or manager.policy for project 11.',
      'The required data is still missing because no tool results have been returned for project 11.',
      'Gate: tool outputs never provided. Unblock requires those four results.',
      'I am still awaiting the tool results for project 11.',
    ];
    for (const s of stalls) expect(claimsMissingToolData(s), s).toBe(true);
  });

  /**
   * The discriminator is the word "tool" NEXT TO the missing-data claim. An agent that
   * genuinely cannot answer — or that called a tool and got an error back — has given a
   * real answer, and re-prompting it wastes a turn and repeats itself at the user.
   */
  it('does NOT match a genuine "I cannot answer that" reply', () => {
    const answers = [
      'I do not have the task status data for project 11.',
      'Nothing merged today because merge authority is withheld from me on this project.',
      'The digest is empty for today — 0 tickets finished, same as yesterday.',
      'No decisions were recorded, so there is nothing to report.',
      'The census returned 281 stalled tickets; the oldest has been idle 48 days.',
      'Two tools cover that: builtin_tasks_create and builtin_tasks_update.',
      // A FILE name is not a tool name — a coding agent reports this constantly.
      'The build failed — missing package.json in the worker directory.',
      'No results for src/index.ts; the file was deleted in PR #302.',
    ];
    for (const a of answers) expect(claimsMissingToolData(a), a).toBe(false);
  });

  it('matches the claim when the TOOL is named instead of the word "tool"', () => {
    const stalls = [
      'Little accomplished today: missing manager.digest, manager.decisions, manager.census and manager.policy results for project 11.',
      'No data from builtin_manager_policy, so I cannot say what I was permitted to do.',
    ];
    for (const s of stalls) expect(claimsMissingToolData(s), s).toBe(true);
  });

  it('has no opinion on empty text', () => {
    expect(claimsMissingToolData('')).toBe(false);
    expect(claimsMissingToolData('   ')).toBe(false);
  });

  /**
   * Unlike the announcement shape this is NOT tail-limited: the claim is normally the
   * opening sentence, with the consequences spelled out after it.
   */
  it('matches the claim wherever it sits in the reply', () => {
    const opening = 'The required tools have not returned results yet. '.padEnd(600, 'x');
    expect(claimsMissingToolData(opening)).toBe(true);
  });
});

/**
 * The gate itself lives here rather than in each loop, so the Brain run loop and the
 * on-prem/cloud agent loop cannot drift on WHEN a stall is recoverable.
 */
describe('shouldRecoverStalledTurn', () => {
  const stall = {
    text: "I'll search the codebase for the handler.",
    toolCallCount: 0,
    availableToolCount: 12,
    recoveriesUsed: 0,
  };

  it('recovers an announcement made with tools available and budget left', () => {
    expect(shouldRecoverStalledTurn(stall)).toBe(true);
  });

  it('never fires when the turn actually called a tool', () => {
    expect(shouldRecoverStalledTurn({ ...stall, toolCallCount: 1 })).toBe(false);
  });

  it('never fires when the turn had no tools to call', () => {
    expect(shouldRecoverStalledTurn({ ...stall, availableToolCount: 0 })).toBe(false);
  });

  it('stops once the per-run budget is spent', () => {
    for (let used = 0; used < MAX_ANNOUNCEMENT_RECOVERIES; used++) {
      expect(shouldRecoverStalledTurn({ ...stall, recoveriesUsed: used }), `used=${used}`).toBe(true);
    }
    expect(shouldRecoverStalledTurn({ ...stall, recoveriesUsed: MAX_ANNOUNCEMENT_RECOVERIES })).toBe(false);
  });

  it('lets a genuine final answer through untouched', () => {
    expect(shouldRecoverStalledTurn({ ...stall, text: 'The build failed because the token expired.' })).toBe(false);
  });

  it('recovers the missing-tool-data claim too — same remedy, different excuse', () => {
    expect(shouldRecoverStalledTurn({
      ...stall,
      text: 'The required tools have not returned results yet, so I have no new data for project 11.',
    })).toBe(true);
  });

  it('allows more than one recovery — the stall repeats', () => {
    expect(MAX_ANNOUNCEMENT_RECOVERIES).toBeGreaterThan(1);
  });
});

/**
 * The other half of "it just dies": when every recovery is spent and the model is
 * STILL only describing calls, a loop that returns normally shows the promise as the
 * answer and reads as a success. This gate is what lets each loop say so out loud.
 */
describe('isExhaustedStall', () => {
  const stall = {
    text: 'run tool builtin_chats_list_tickets with chatId is 85',
    toolCallCount: 0,
    availableToolCount: 43,
    recoveriesUsed: MAX_ANNOUNCEMENT_RECOVERIES,
  };

  it('fires only once the recovery budget is spent', () => {
    expect(isExhaustedStall(stall)).toBe(true);
    expect(isExhaustedStall({ ...stall, recoveriesUsed: MAX_ANNOUNCEMENT_RECOVERIES - 1 })).toBe(false);
  });

  it('is the exact complement of shouldRecoverStalledTurn — never both, never neither', () => {
    // Any turn that IS a stall is either recoverable or exhausted; a non-stall is
    // neither. Drift between the two would silently drop or double-report a run.
    for (const used of [0, 1, MAX_ANNOUNCEMENT_RECOVERIES, MAX_ANNOUNCEMENT_RECOVERIES + 5]) {
      const input = { ...stall, recoveriesUsed: used };
      expect(shouldRecoverStalledTurn(input) && isExhaustedStall(input), `used=${used}`).toBe(false);
      expect(shouldRecoverStalledTurn(input) || isExhaustedStall(input), `used=${used}`).toBe(true);
    }
  });

  it('never fires on a genuine answer, or when the turn actually acted', () => {
    expect(isExhaustedStall({ ...stall, text: 'The build failed because the token expired.' })).toBe(false);
    expect(isExhaustedStall({ ...stall, toolCallCount: 1 })).toBe(false);
    expect(isExhaustedStall({ ...stall, availableToolCount: 0 })).toBe(false);
  });
});

/**
 * The fourth shape. A turn with tools available that returns neither a call nor a word
 * is the same "would not act" failure with the narration stripped off — and it used to
 * fall straight out of every loop as a transient blip. On the manager's chat that blip
 * reached the operator as a 400 saying "this usually clears on a retry", four days
 * running, while nothing had retried anything.
 */
describe('isEmptyTurn', () => {
  const base = { text: '', toolCallCount: 0, availableToolCount: 43, recoveriesUsed: 0 };

  it('recognises a turn that produced neither a call nor a word', () => {
    expect(isEmptyTurn(base)).toBe(true);
    expect(isEmptyTurn({ ...base, text: '   \n  ' })).toBe(true);
  });

  it('is not an empty turn when the model said something, or acted', () => {
    expect(isEmptyTurn({ ...base, text: 'Nothing merged today.' })).toBe(false);
    expect(isEmptyTurn({ ...base, toolCallCount: 1 })).toBe(false);
  });

  it('leaves a plain completion alone — no tools offered is not a stall', () => {
    // An empty answer from a turn with nothing to call is the caller's problem; this
    // package only speaks to turns that COULD have acted.
    expect(isEmptyTurn({ ...base, availableToolCount: 0 })).toBe(false);
  });

  it('is recovered and then failed over like every other stall shape', () => {
    expect(shouldRecoverStalledTurn(base)).toBe(true);
    expect(isExhaustedStall({ ...base, recoveriesUsed: MAX_ANNOUNCEMENT_RECOVERIES })).toBe(true);
  });
});

describe('stallExhaustedNotice', () => {
  it('describes a BLANK turn as blank, not as narration that was never there', () => {
    const blank = stallExhaustedNotice('direct/meta/muse-spark-1.1', [], true);
    expect(blank).toContain('returned an empty turn');
    expect(blank).not.toContain('described tool calls');
    // There is no prose above it to mistake for work — say so rather than referring
    // the reader to an "answer above" that does not exist.
    expect(blank).toContain('no answer above');
    expect(blank).not.toContain('description of intended actions');
  });

  it('names the model, and sends the reader to the log before they switch it', () => {
    expect(stallExhaustedNotice('xai-oauth/grok-4.3')).toContain('xai-oauth/grok-4.3');
    expect(stallExhaustedNotice('xai-oauth/grok-4.3')).toContain('check your runtime or gateway log');
  });

  it('never claims this cannot be a configuration problem', () => {
    // It said exactly that, and was wrong where it mattered most: a self-hosted runtime
    // rejecting every request for an over-length prompt is indistinguishable from here,
    // and the notice sent the reader to change models while their server log held the
    // real reason. A notice may describe what it saw; it may not rule out what it
    // cannot see.
    const notice = stallExhaustedNotice('local/freetoken/gpt-oss-20b');
    expect(notice).not.toContain('not a configuration error');
    expect(notice).toContain('context limit');
  });

  it('reads sensibly when the loop never resolved a model', () => {
    for (const m of [undefined, null, '', 'default']) {
      expect(stallExhaustedNotice(m)).toContain('The model described tool calls');
    }
  });

  it('says nothing ran, so the text above is not mistaken for work done', () => {
    expect(stallExhaustedNotice('m')).toContain('nothing was actually run');
  });

  /**
   * Once the run has ALREADY swapped models, "pick a different model" is bad advice —
   * two of them just refused, so the reader should be pointed at the tool catalog.
   */
  it('changes the advice once the run already failed over', () => {
    const out = stallExhaustedNotice('coder-1', ['xai-oauth/grok-4.3', 'coder-1']);
    expect(out).toContain('xai-oauth/grok-4.3');
    expect(out).toContain('unlikely to be any single model');
    expect(out).toContain('Tools available to the model');
    expect(out).not.toContain('pick a different model');
  });

  it('does not list the current model as one it failed over FROM', () => {
    // The single-model branch, identified by the advice it ends with.
    expect(stallExhaustedNotice('coder-1', ['coder-1'])).toContain('check your runtime or gateway log');
  });
});

/**
 * Same pattern, two consumers: the stall detector recognises a call written as prose,
 * and the per-turn tool SELECTOR uses this to find the tools a system prompt tells the
 * model to call. If those drifted, the selector could drop a tool the prompt promises
 * and the loop would spend its recovery budget on a stall the selector itself caused.
 */
describe('toolNamesMentionedIn', () => {
  it('pulls the tools a system-prompt directive instructs the model to call', () => {
    const directive = 'Always call builtin_chats_list_tickets first, then builtin_tasks_update, '
      + 'and link via builtin_chats_link_ticket. External servers use mcp__github__list_prs.';
    expect(toolNamesMentionedIn(directive)).toEqual([
      'builtin_chats_list_tickets',
      'builtin_tasks_update',
      'builtin_chats_link_ticket',
      'mcp__github__list_prs',
    ]);
  });

  it('de-duplicates, because a directive names the same tool more than once', () => {
    expect(toolNamesMentionedIn('builtin_tasks_create … then builtin_tasks_create again'))
      .toEqual(['builtin_tasks_create']);
  });

  it('finds nothing in prose that names no tool', () => {
    expect(toolNamesMentionedIn('Answer the user politely and cite your sources.')).toEqual([]);
    expect(toolNamesMentionedIn('')).toEqual([]);
  });
});

describe('modelFailoverNotice', () => {
  it('names both ends of the swap, so a changed model is never silent', () => {
    const out = modelFailoverNotice('xai-oauth/grok-4.3', 'coder-1');
    expect(out).toContain('xai-oauth/grok-4.3');
    expect(out).toContain('Retrying on `coder-1`');
  });

  it('reads sensibly when the run pinned nothing', () => {
    for (const from of [undefined, null, '', 'default']) {
      expect(modelFailoverNotice(from, 'coder-1')).toContain('The previous model');
    }
  });

  it('allows at least one swap, and stops well short of the whole catalog', () => {
    expect(MAX_MODEL_FAILOVERS).toBeGreaterThan(0);
    expect(MAX_MODEL_FAILOVERS).toBeLessThanOrEqual(3);
  });
});

describe('stallRecoveryNudge', () => {
  it('always demands the call be made in this turn', () => {
    for (const last of [false, true]) {
      expect(stallRecoveryNudge(last)).toContain('made zero tool calls');
      expect(stallRecoveryNudge(last)).toContain('Do not announce another call');
      // It has to cover every shape it is sent for, or the model reads a correction
      // aimed at something it did not do and repeats itself. A blank turn is one.
      expect(stallRecoveryNudge(last)).toContain('do not reply with an empty message');
    }
  });

  it('escalates only on the final attempt', () => {
    expect(stallRecoveryNudge(false)).not.toContain('last chance');
    expect(stallRecoveryNudge(true)).toContain('last chance');
  });
});
