/**
 * The publish hold's LIFT matcher (`asksToShip`) and the fold over person turns. Incident
 * #56886 class: a "don't commit until I validate" hold must survive a later turn that merely
 * mentions a publish word as a noun ("push notification", "release notes").
 */
import { describe, expect, it } from 'vitest';
import { asksToShip, publishHold, publishHoldFromPersonTurns } from './publishHold';
import { personTurns } from './chatAsks';

const LIFTS: readonly string[] = [
  'commit',
  'Push.',
  'ship it',
  'Ship it!',
  'go ahead and commit',
  'Go ahead and push it',
  'ok, commit and push',
  'Looks good, push it to main',
  'lgtm - you can commit now',
  'Validated. You can commit now.',
  'you can ship now',
  'feel free to push',
  'commit the changes',
  'merge it',
  'please open a PR',
  'Okay, release it',
  'land it',
  'it is fine to push',
  'Thanks! Commit everything.',
  // regression (review): question-form and colloquial go-aheads were false HOLDS.
  'can you commit?',
  'could you push it',
  "you're good to push",
  // regression: two chained publish verbs, an arbitrary direct object, and the
  // doc-comment's own "commit it, then push" example all LIFT the hold.
  'commit and push',
  'commit and push the triage doc',
  'commit it, then push',
  'commit it and push',
  'go ahead and commit and push',
  'commit and push to main',
  'push the triage doc',
  'push the fix',
  'merge the pull request',
];

const KEEPS_HOLD: readonly string[] = [
  'fix the push notification handler',
  'update the release notes',
  'Push notifications are broken on Android',
  'Release notes need a section for the new API',
  'the commit message format is wrong in the changelog script',
  'add a ship-date field to the order form',
  'merge the two config objects in settings.ts',
  'continue with guidance',
  "don't push yet",
  'do not commit until I have checked the tests',
  'you can push notifications through FCM instead',
  'make the publish button blue',
  'the landing page title is off',
  '',
  // regression (review): deferred orders were false LIFTS.
  'commit it after I check the tests',
  'push it tomorrow',
  'Ship it, but not yet',
  'go ahead and commit once CI is green',
  // A bare affirmative with no publish question before it orders nothing.
  'yes',
  'go ahead',
  // regression: an arbitrary `the`-phrase that is NOT a clean noun object must
  // still keep the hold (adjective / verb-led / too long / verb + object).
  'make the publish button blue',
  'push the button blue',
  'push the deploy when you are ready',
  'push the thing that I sent you earlier today',
  'commit the message format is wrong in the changelog script',
];

describe('asksToShip — the publish-hold lift matcher', () => {
  for (const phrase of LIFTS) {
    it(`lifts on "${phrase}"`, () => {
      expect(asksToShip(phrase)).toBe(true);
    });
  }
  for (const phrase of KEEPS_HOLD) {
    it(`does not lift on "${phrase}"`, () => {
      expect(asksToShip(phrase)).toBe(false);
    });
  }
  it('regression: a bare "yes" / "go ahead" answering "shall I commit/push?" lifts', () => {
    expect(asksToShip('yes', 'All 12 files are done and the tests pass. Shall I commit and push?')).toBe(true);
    expect(asksToShip('Go ahead.', 'Do you want me to push this to main?')).toBe(true);
    expect(asksToShip('yes please', 'Would you like me to open a PR?')).toBe(true);
  });

  it('a bare affirmative to some OTHER question, or a qualified yes, does not lift', () => {
    expect(asksToShip('yes', 'Shall I also fix the push notification handler?')).toBe(false);
    expect(asksToShip('yes', 'Want me to add a test?')).toBe(false);
    expect(asksToShip('yes but fix the lint first', 'Shall I commit?')).toBe(false);
    expect(asksToShip('yes, after lunch', 'Shall I push?')).toBe(false);
  });

  it('is false for null / undefined', () => {
    expect(asksToShip(null)).toBe(false);
    expect(asksToShip(undefined)).toBe(false);
  });
});

describe('publishHoldFromPersonTurns', () => {
  const HOLD = "don't commit the code until I have validated all the changes";

  it('regression: "fix the push notification handler" keeps the hold', () => {
    const hold = publishHoldFromPersonTurns([{ text: HOLD }, { text: 'fix the push notification handler' }]);
    expect(hold).toEqual({ messageNumber: 1, text: HOLD });
  });

  it('regression: "update the release notes" keeps the hold', () => {
    const hold = publishHoldFromPersonTurns([{ text: HOLD }, { text: 'update the release notes' }]);
    expect(hold).toEqual({ messageNumber: 1, text: HOLD });
  });

  it('an explicit go-ahead lifts the hold', () => {
    expect(publishHoldFromPersonTurns([{ text: HOLD }, { text: 'validated - go ahead and commit' }])).toBeNull();
  });

  it('a later decline re-arms the hold after a lift (the last relevant turn wins)', () => {
    const hold = publishHoldFromPersonTurns([{ text: HOLD }, { text: 'ship it' }, { text: 'wait, do not push' }]);
    expect(hold).toEqual({ messageNumber: 3, text: 'wait, do not push' });
  });

  it('regression: publishHold reads the assistant turn a bare "yes" answers', () => {
    const user = (content: string) => { const m = { role: 'user' as const, content }; personTurns.add(m); return m; };
    const convo = [user(HOLD), { role: 'assistant' as const, content: 'Validated locally. Shall I commit and push now?' }, user('yes')];
    expect(publishHold(convo)).toBeNull();
    const unrelated = [user(HOLD), { role: 'assistant' as const, content: 'Shall I rename the helper?' }, user('yes')];
    expect(publishHold(unrelated)?.messageNumber).toBe(1);
  });

  it('a ship order with no hold standing changes nothing', () => {
    expect(publishHoldFromPersonTurns([{ text: 'commit it' }])).toBeNull();
  });
});
