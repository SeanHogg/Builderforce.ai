/**
 * Each live target's `ProofMeasure` (PRD 33 §5.3.1) is filled ONLY from numbers its
 * own charter states — and a target whose criteria are not visitor behaviour
 * declares none. One assertion per target, so a new target, or a charter that
 * changes its numbers, has to decide here what grades it.
 */
import { describe, expect, it } from 'vitest';
import { parseProofMeasure } from '@builderforce/interaction-contract';
import type { ChallengeSpec } from '../../challenge/parseBrief';
import { planRealization } from '../planRealization';
import type { RealizationKey } from '../realizationTarget';
import { REALIZATION_TARGETS, realizationTargetByKey } from './index';
import { SMOKE_SOURCE_TAG, SMOKE_SUCCESS_EVENT, SMOKE_UNNAMED_SOURCE } from './smokeTest';

const spec = {
  title: 'Acme Concierge',
  sponsor: 'Acme operations',
  goal: 'Answer customer questions about orders without a person reading every message.',
  capabilities: ['analytics', 'email'],
  integrations: [],
  deliverables: [],
  constraints: [],
  successCriteria: [],
} as ChallengeSpec;

const build = (key: RealizationKey) => realizationTargetByKey(key)!.build({ spec, ingressUrl: 'https://api.test/hooks/tok' });

/** Why each target without a measure has none — the criterion is not visitor behaviour. */
const NOT_VISITOR_BEHAVIOUR: Record<Exclude<RealizationKey, 'smoke-test'>, string> = {
  'demo-video': 'five people outside the team describing it — an interview, no site',
  'clickable-prototype': 'a moderated, offline task session recorded in sessions.md — no hosted site',
  'wizard-of-oz': 'requests FULFILLED by a human inside the SLA — operator work, not visitor behaviour',
  poc: 'a pass rate over judged trials — a harness, not visitors',
  pilot: '"very disappointed" share of a named cohort — a survey answer',
  'phone-line': 'calls and SMS answered — telephony, not page visits',
  'live-system': 'endpoints live and an on-call runbook — operations',
};

describe('smoke-test measure', () => {
  const output = build('smoke-test');
  const charter = output.files['smoke-test/charter.md']!;
  const charterNumber = (label: RegExp) => Number(label.exec(charter)?.[1]);

  it('matches the charter numbers exactly', () => {
    const target = charterNumber(/Signups needed \| \*\*(\d+)\*\*/);
    const sample = charterNumber(/Out of at least \| \*\*(\d+)\*\*/);
    const windowDays = charterNumber(/Window \| \*\*(\d+) days\*\*/);
    expect([target, sample, windowDays]).toEqual([25, 500, 14]);

    expect(output.measure).toEqual({
      sample: {
        filter: {
          all: [
            { field: 'visitedPath', op: 'in', value: ['/', '/index.html'] },
            { field: 'tag', op: 'neq', value: `${SMOKE_SOURCE_TAG}=${SMOKE_UNNAMED_SOURCE}` },
          ],
        },
        min: sample,
      },
      success: { kind: 'smartEvent', ref: 'sign up' },
      threshold: { op: '>=', value: target, unit: 'count' },
      windowDays,
    });
  });

  it('is a valid contract measure, and planning carries it to the create route', () => {
    expect(parseProofMeasure(output.measure)).toEqual(output.measure);
    expect(planRealization(spec, realizationTargetByKey('smoke-test')!, '').measure).toEqual(output.measure);
  });

  it('the landing page tags the source on load and reports the success event on a stored signup', () => {
    const page = output.files['index.html']!;
    expect(page).toContain(`window.BFReplay && BFReplay.tag('${SMOKE_SOURCE_TAG}', source);`);
    expect(page).toContain("query.get('utm_source') || query.get('ref')");
    const success = page.indexOf(`BFReplay.event('${SMOKE_SUCCESS_EVENT}')`);
    expect(success).toBeGreaterThan(page.indexOf("if (!res.ok) throw new Error('rejected');"));
    expect(SMOKE_SUCCESS_EVENT).toBe('sign up');
  });
});

describe.each(Object.entries(NOT_VISITOR_BEHAVIOUR))('%s measure', (key, why) => {
  it(`is undefined — ${why}`, () => {
    expect(build(key as RealizationKey).measure).toBeUndefined();
    expect(planRealization(spec, realizationTargetByKey(key)!, '').measure).toBeNull();
  });
});

it('every target is accounted for here', () => {
  expect(REALIZATION_TARGETS.map((t) => t.key).sort()).toEqual(['smoke-test', ...Object.keys(NOT_VISITOR_BEHAVIOUR)].sort());
});
