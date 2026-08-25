/**
 * THE PARTNER-PROGRAM REGISTRY, and the contract it has with a UI it cannot import.
 *
 * `TRACK_DEFINITIONS` emits localization KEY STEMS and the frontend renders whatever
 * it is sent. A key added here and not translated appears in the middle of a
 * partner-facing page as its own dotted name — a failure that no type checks, because
 * the two halves are separate toolchains and `check:source-package-graph` is the guard
 * that says they must stay so.
 *
 * CONTRIBUTING §1's stated fallback for exactly this case is that both sides assert
 * agreement over the WHOLE domain rather than over a chosen handful. This is that
 * assertion from the API's side; `frontend/src/i18n/messages.test.ts` is the other,
 * and it proves every key below resolves in all five locales.
 */

import { describe, expect, it } from 'vitest';
import { PARTNER_TRACKS } from './extensionContract';
import { TRACK_DEFINITIONS, revShareSchedule, trackDefinition } from './partnerPrograms';

/**
 * Every benefit key the frontend has a label for.
 *
 * The mirror of `PARTNER_BENEFIT_KEYS` in `frontend/src/lib/builderforceApi.ts`.
 * Adding a benefit to `TRACK_DEFINITIONS` fails this test until it is added here AND
 * translated there — which is the point: the failure lands on the person adding it,
 * not on a partner reading `programs.benefit.newThing` on a live page.
 */
const TRANSLATED_BENEFIT_KEYS = [
  'openRegistration',
  'zeroRevShare',
  'directoryListing',
  'installAnalytics',
  'featuredPlacement',
  'nativeBilling',
  'installWebhooks',
  'coMarketing',
  'engineeringSupport',
  'leadMatchmaking',
  'revShare',
  'enterpriseIntroductions',
] as const;

/** The mirror of `PARTNER_AUDIENCE_KEYS`, for the same reason. */
const TRANSLATED_AUDIENCE_KEYS = ['selfServe', 'vendors', 'agencies'] as const;

describe('TRACK_DEFINITIONS — the localization contract', () => {
  it('emits no benefit key the frontend cannot label', () => {
    const emitted = new Set(TRACK_DEFINITIONS.flatMap((d) => d.benefits.map((b) => b.key)));
    const untranslatable = [...emitted].filter((k) => !(TRANSLATED_BENEFIT_KEYS as readonly string[]).includes(k));
    expect(untranslatable).toEqual([]);
  });

  it('emits no audience key the frontend cannot label', () => {
    const emitted = TRACK_DEFINITIONS.map((d) => d.audienceKey);
    const untranslatable = emitted.filter((k) => !(TRANSLATED_AUDIENCE_KEYS as readonly string[]).includes(k));
    expect(untranslatable).toEqual([]);
  });

  it('leaves no translated key without a producer', () => {
    // The other direction, and it matters as much: a key that is translated,
    // reviewed and shipped in five languages while nothing on the server can ever
    // send it is dead copy nobody will notice for a year.
    const emitted = new Set(TRACK_DEFINITIONS.flatMap((d) => d.benefits.map((b) => b.key)));
    const orphaned = TRANSLATED_BENEFIT_KEYS.filter((k) => !emitted.has(k));
    expect(orphaned).toEqual([]);
  });

  it('defines exactly the tracks the column vocabulary allows', () => {
    expect(TRACK_DEFINITIONS.map((d) => d.track).sort()).toEqual([...PARTNER_TRACKS].sort());
  });

  it('resolves every track to a definition, including an unknown one', () => {
    // Total by construction: `trackDefinition` falls back to self-serve, so a row
    // carrying a track this build does not know renders as the default rather than
    // crashing a partner's page.
    for (const track of PARTNER_TRACKS) expect(trackDefinition(track).track).toBe(track);
    expect(trackDefinition('nonsense' as never).track).toBe('none');
  });
});

describe('TRACK_DEFINITIONS — what it claims', () => {
  it('names a mechanism for every benefit', () => {
    // A benefit with no mechanism is a promise with no producer, which is the
    // defect the module header refuses by name.
    const unmechanised = TRACK_DEFINITIONS.flatMap((d) => d.benefits).filter((b) => !b.mechanism.trim());
    expect(unmechanised).toEqual([]);
  });

  it('marks the human commitments as NOT automated', () => {
    // Co-marketing and engineering hours are things people do. Presenting them
    // beside `featuredPlacement` as though the platform delivered them would be
    // promising something no code keeps.
    const byKey = new Map(TRACK_DEFINITIONS.flatMap((d) => d.benefits).map((b) => [b.key, b.automated]));
    expect(byKey.get('coMarketing')).toBe(false);
    expect(byKey.get('engineeringSupport')).toBe(false);
    expect(byKey.get('enterpriseIntroductions')).toBe(false);
    expect(byKey.get('featuredPlacement')).toBe(true);
    expect(byKey.get('nativeBilling')).toBe(true);
  });

  it('offers self-serve publishing at zero rev-share, with no application', () => {
    // §6 Phase B. `none` is the DEFAULT and must not read as a lesser state — most
    // publishers should never need to be in a program at all.
    const selfServe = trackDefinition('none');
    const keys = selfServe.benefits.map((b) => b.key);
    expect(keys).toContain('openRegistration');
    expect(keys).toContain('zeroRevShare');
    expect(selfServe.benefits.every((b) => b.automated)).toBe(true);
  });
});

describe('revShareSchedule — projected, never recomputed', () => {
  it('reads the platform default: 15% above $200,000 lifetime, 0% below', () => {
    // PRD 24 §9 decision 1 asks for a threshold. The platform already had one, and
    // this asserts the PROJECTION matches it rather than declaring a second number
    // a partner would have to reconcile against their earnings page.
    const schedule = revShareSchedule({} as never);
    expect(schedule.bps).toBe(1500);
    expect(schedule.percent).toBe(15);
    expect(schedule.thresholdCents).toBe(20_000_000);
    expect(schedule.belowThresholdBps).toBe(0);
  });

  it('follows the deployment when an operator configures it', () => {
    const schedule = revShareSchedule({
      MARKETPLACE_TAKE_RATE_BPS: '1000',
      MARKETPLACE_TAKE_RATE_THRESHOLD_CENTS: '5000000',
    } as never);
    expect(schedule.bps).toBe(1000);
    expect(schedule.percent).toBe(10);
    expect(schedule.thresholdCents).toBe(5_000_000);
  });

  it('reads a mistyped rate as the default rather than as a hundredfold error', () => {
    // `parseInt('50%')` is 50 — 0.5% — which is a legal-looking rate and wrong by a
    // factor of a hundred. The reader this projects through refuses it.
    expect(revShareSchedule({ MARKETPLACE_TAKE_RATE_BPS: '50%' } as never).bps).toBe(1500);
  });
});
