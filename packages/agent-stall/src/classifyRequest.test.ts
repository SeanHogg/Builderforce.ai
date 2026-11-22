import { describe, expect, it } from 'vitest';
import { classifyRequest, splitAskAndContext } from './classifyRequest.js';
import { asksForChange, isContinuationDirective } from './requestIntent.js';

// Fix brief W2, chat #168571: a pure question whose PASTE was full of change verbs
// routed `full` and armed a commit ship policy. One classifier, judged on the ask.
const INCIDENT_ASK = 'Review the recommendation for the MCP below; Is this something we want to do?';
const INCIDENT_PASTE = [
  'Recommendation: hosted MCP server hardening',
  '1. Let clients call initialize and tools/list without a token (+30).',
  '2. Add an icon to server.json and republish the package (+4).',
  'Then update the listing, create a release and publish it to the registry.',
].join('\n');

interface Case {
  name: string;
  text: string;
  intent: 'question' | 'change';
  ask?: string;
}

const CASES: readonly Case[] = [
  // The incident, verbatim ask + a paste full of add/publish/let verbs.
  { name: 'incident #168571 verbatim', text: `${INCIDENT_ASK}\n\n${INCIDENT_PASTE}`, intent: 'question', ask: INCIDENT_ASK },
  { name: 'incident ask alone', text: INCIDENT_ASK, intent: 'question', ask: INCIDENT_ASK },
  // The brief's change cases.
  { name: 'fix X', text: 'fix X', intent: 'change' },
  { name: 'implement Y', text: 'implement Y', intent: 'change' },
  { name: 'continue unfinished work', text: "continue this chat's unfinished work", intent: 'change' },
  { name: 'review + chained fix', text: 'review this PR and fix what you find', intent: 'change' },
  // The brief's question cases.
  { name: 'review — should we', text: 'review this recommendation — should we do it?', intent: 'question' },
  {
    name: 'question + pasted diff of add/fix verbs',
    text: 'What do you think of this diff?\n\n+ add the retry loop\n+ fix the null guard\n- remove the old flag\n+ update the schema and migrate the rows',
    intent: 'question',
    ask: 'What do you think of this diff?',
  },
  // The new question leads.
  { name: 'is this something we want', text: 'is this something we want to do?', intent: 'question' },
  { name: 'should we', text: 'should we adopt the hosted server?', intent: 'question' },
  { name: 'do we want', text: 'do we want this behaviour on mobile?', intent: 'question' },
  { name: 'what do you think', text: 'what do you think of the ranking approach?', intent: 'question' },
  { name: 'worth doing', text: 'is this worth doing before the release?', intent: 'question' },
  // An imperative aimed at us keeps a question-shaped ask a change.
  { name: 'modal + imperative', text: 'Can you fix the session refresh?', intent: 'change' },
  { name: 'question mark on a work order', text: 'Could you update the README?', intent: 'change' },
  // A verb inside an interrogative is about a change, not a request for one.
  { name: 'how do I add', text: 'How do I add a column?', intent: 'question' },
  { name: 'why did you change', text: 'Why did you change the height?', intent: 'question' },
  // Research leads: alone a question, chained a work order.
  { name: 'review alone', text: 'Review the PRD', intent: 'question' },
  { name: 'review then implement', text: 'Review the PRD. Implement WS1.', intent: 'change' },
  // A bare directive resumes the change the turn above proposed.
  { name: 'bare continuation', text: 'go ahead', intent: 'change' },
  // A colon lead points at the paste too.
  {
    name: 'colon lead + paste',
    text: 'Here is the error:\n\nTypeError: cannot read properties of undefined\nFix it by adding a guard, then update the caller.',
    intent: 'question',
    ask: 'Here is the error:',
  },
];

describe('classifyRequest — one classifier, ask vs pasted context (W2)', () => {
  for (const c of CASES) {
    it(`${c.name} ⇒ ${c.intent}`, () => {
      const verdict = classifyRequest(c.text);
      expect(verdict.intent).toBe(c.intent);
      if (c.ask !== undefined) {
        expect(verdict.ask).toBe(c.ask);
        const split = c.text.trim() !== c.ask;
        expect(verdict.signals.askSplit).toBe(split);
        if (split) expect(verdict.context.length).toBeGreaterThan(0);
      }
      // The wrappers every existing caller uses agree with the classifier.
      expect(asksForChange(c.text)).toBe(c.intent === 'change');
    });
  }

  it('the incident paste carries the verbs — the ask does not decide on them', () => {
    const verdict = classifyRequest(`${INCIDENT_ASK}\n\n${INCIDENT_PASTE}`);
    expect(verdict.signals.changeVerb).toBe(false);
    expect(verdict.context).toContain('republish');
    expect(verdict.signals.questionLead).toBe(true);
  });

  it('a lead that neither asks nor points below stays whole — its verbs still count', () => {
    const text = 'Fix the parser crash\n\nIt happens on empty input; add a guard and update the tests.';
    const verdict = classifyRequest(text);
    expect(verdict.ask).toBe(text);
    expect(verdict.context).toBe('');
    expect(verdict.intent).toBe('change');
  });

  it('is empty-safe', () => {
    for (const t of ['', null, undefined]) {
      expect(classifyRequest(t).intent).toBe('question');
      expect(classifyRequest(t).ask).toBe('');
    }
  });

  it('splitAskAndContext splits only a lead that ends ?/: or points at what follows', () => {
    expect(splitAskAndContext('Is this right?\n\npasted body').ask).toBe('Is this right?');
    expect(splitAskAndContext('See the following:\n\npasted body').ask).toBe('See the following:');
    expect(splitAskAndContext('Check this\n\npasted body').ask).toBe('Check this');
    expect(splitAskAndContext('Fix the parser\n\npasted body').ask).toBe('Fix the parser\n\npasted body');
  });

  it('the continuation wrapper and the classifier share one vocabulary', () => {
    for (const t of ['Fix', 'do it', 'yes', 'ship it']) {
      expect(isContinuationDirective(t)).toBe(true);
      expect(classifyRequest(t).signals.continuation).toBe(true);
      expect(classifyRequest(t).intent).toBe('change');
    }
    expect(isContinuationDirective('fix the login redirect')).toBe(false);
  });
});
