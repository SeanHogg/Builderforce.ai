/**
 * The publish hold's LIFT matcher (`asksToShip`) and the fold over person turns. Incident
 * #56886 class: a "don't commit until I validate" hold must survive a later turn that merely
 * mentions a publish word as a noun ("push notification", "release notes").
 */
import { describe, expect, it } from 'vitest';
import { asksToShip, publishHoldFromPersonTurns } from './publishHold';

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

  it('a ship order with no hold standing changes nothing', () => {
    expect(publishHoldFromPersonTurns([{ text: 'commit it' }])).toBeNull();
  });
});
