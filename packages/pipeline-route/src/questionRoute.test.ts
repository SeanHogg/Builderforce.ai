import { describe, expect, it } from 'vitest';
import { pipelineFeaturesOf, scorePipeline } from './index.js';

// Fix brief W2, chat #168571: "Review the recommendation for the MCP below; Is this
// something we want to do?" + a third-party paste full of add/publish/let verbs
// routed `full` at 0.86 — CHANGE_VERB_RE tested the whole text, so questionOnly's
// −1.3 never applied. The ONE classifier now judges the ask alone.
const ASK = 'Review the recommendation for the MCP below; Is this something we want to do?';
const PASTE = [
  'Recommendation: hosted MCP server hardening',
  '1. Let clients call initialize and tools/list without a token (+30).',
  '2. Add an icon to server.json and republish the package (+4).',
  'Then update the listing, create a release and publish it to the registry.',
].join('\n');

describe('regression: chat #168571 — a question routes quick whatever the paste says', () => {
  it('the incident message verbatim is question-only and routes quick', () => {
    for (const actionType of ['other', 'backend_api', 'decision', 'analysis']) {
      const f = pipelineFeaturesOf(`${ASK}\n\n${PASTE}`, { actionType });
      expect(f.questionOnly).toBe(true);
      const scored = scorePipeline(f);
      expect(scored.route).toBe('quick');
    }
  });

  it('the paste adds no length, files, steps or scope — only the ask is scored', () => {
    const alone = pipelineFeaturesOf(ASK);
    const withPaste = pipelineFeaturesOf(`${ASK}\n\n${PASTE}`);
    expect(withPaste).toEqual(alone);
    expect(alone.requestChars).toBe(ASK.length);
    expect(alone.fileMentions).toBe(0);
    expect(alone.multiStep).toBe(false);
  });

  it('a question followed by a pasted diff full of add/fix verbs stays quick', () => {
    const f = pipelineFeaturesOf('What do you think of this diff?\n\n+ add retry\n+ fix the guard\n+ migrate the rows', { actionType: 'backend_api' });
    expect(f.questionOnly).toBe(true);
    expect(scorePipeline(f).route).toBe('quick');
  });

  it('the brief\'s change cases still route on their own verbs', () => {
    for (const text of ['fix X', 'implement Y', "continue this chat's unfinished work", 'review this PR and fix what you find']) {
      expect(pipelineFeaturesOf(text).questionOnly).toBe(false);
    }
  });

  it('"review this recommendation — should we do it?" is a question', () => {
    const f = pipelineFeaturesOf('review this recommendation — should we do it?', { actionType: 'decision' });
    expect(f.questionOnly).toBe(true);
    expect(scorePipeline(f).route).toBe('quick');
  });
});
