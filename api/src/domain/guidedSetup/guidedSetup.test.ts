/**
 * The guided-setup rules, tested against literals rather than a database —
 * which is the reason `resolveGuidedPlan` takes its facts as a parameter.
 */

import { describe, it, expect } from 'vitest';
import {
  guidedStepKindSpec,
  parseGuidedSteps,
  registerGuidedStepKind,
  registeredStepKinds,
  EMPTY_SETUP_STATE,
  type GuidedSetupState,
  type GuidedStep,
} from './guidedStep';
import { bindAnswers, referencedBindings, resolveGuidedPlan } from './guidedPlan';

const state = (over: Partial<GuidedSetupState> = {}): GuidedSetupState => ({
  ...EMPTY_SETUP_STATE,
  ...over,
});

describe('parseGuidedSteps', () => {
  it('normalises a well-formed list', () => {
    const { steps, errors } = parseGuidedSteps([
      { id: 'from_email', kind: 'field', fieldType: 'email', title: 'From' },
      { id: 'audience', kind: 'choice', title: 'Audience', options: [{ value: 'a', label: 'A' }] },
    ]);
    expect(errors).toEqual([]);
    expect(steps.map((s) => s.kind)).toEqual(['field', 'choice']);
    expect(steps[0]!.required).toBe(true);
  });

  it('reports every problem, not just the first', () => {
    const { errors } = parseGuidedSteps([
      { id: 'BAD ID', kind: 'field', title: 'x' },
      { id: 'ok', kind: 'nope', title: 'y' },
    ]);
    expect(errors).toHaveLength(2);
  });

  it('rejects a duplicate id', () => {
    const { steps, errors } = parseGuidedSteps([
      { id: 'a', kind: 'field', title: 'One' },
      { id: 'a', kind: 'field', title: 'Two' },
    ]);
    expect(steps).toHaveLength(1);
    expect(errors.join(' ')).toContain('duplicate');
  });

  it('rejects a choice with neither options nor a source', () => {
    const { errors } = parseGuidedSteps([{ id: 'c', kind: 'choice', title: 'Pick' }]);
    expect(errors.join(' ')).toContain('options or a source');
  });
});

describe('resolveGuidedPlan', () => {
  const steps = parseGuidedSteps([
    { id: 'connect_twilio', kind: 'connect', title: 'Connect Twilio', connector: 'twilio', why: 'To send' },
    { id: 'from_number', kind: 'field', fieldType: 'text', title: 'Number', pattern: '\\+[1-9]\\d{6,14}' },
    { id: 'extra', kind: 'field', fieldType: 'text', title: 'Optional', required: false },
  ]).steps;

  it('blocks on an unconnected required connector', () => {
    const plan = resolveGuidedPlan(steps, { from_number: '+15551234567' }, state());
    expect(plan.complete).toBe(false);
    expect(plan.blockedBy).toContain('connect_twilio');
    expect(plan.missingConnectors).toEqual(['twilio']);
  });

  it('completes once the connector is connected and the field validates', () => {
    const plan = resolveGuidedPlan(
      steps,
      { from_number: '+15551234567' },
      state({ connectedConnectors: new Set(['twilio']) }),
    );
    expect(plan.complete).toBe(true);
    expect(plan.blockedBy).toEqual([]);
  });

  it('anchors a declared pattern rather than matching a substring', () => {
    const plan = resolveGuidedPlan(
      steps,
      { from_number: 'call me on +15551234567 please' },
      state({ connectedConnectors: new Set(['twilio']) }),
    );
    expect(plan.complete).toBe(false);
    expect(plan.blockedBy).toContain('from_number');
  });

  it('stays quiet about steps the person has not reached yet', () => {
    const plan = resolveGuidedPlan(steps, {}, state(), new Set(['connect_twilio']));
    expect(plan.steps.find((s) => s.step.id === 'from_number')!.error).toBeNull();
    // …but still counts them as owed, so the install cannot proceed.
    expect(plan.blockedBy).toContain('from_number');
  });

  it('rejects a sourced answer that is no longer in the live list', () => {
    const sourced = parseGuidedSteps([{
      id: 'audience',
      kind: 'choice',
      title: 'Audience',
      source: { connector: 'mailchimp', action: 'list_audiences', valuePath: 'id' },
    }]).steps;
    const plan = resolveGuidedPlan(
      sourced,
      { audience: 'deleted-list' },
      state({ sourcedOptions: { audience: [{ value: 'live-list', label: 'Live' }] } }),
    );
    expect(plan.complete).toBe(false);
    expect(plan.steps[0]!.error).toContain('no longer available');
  });

  it('supplies a declared default for a step nobody answered', () => {
    const scheduled = parseGuidedSteps([
      { id: 'cadence', kind: 'schedule', title: 'When', defaultCron: '0 9 * * 1' },
    ]).steps;
    const plan = resolveGuidedPlan(scheduled, {}, state());
    expect(plan.complete).toBe(true);
    expect(plan.steps[0]!.value).toEqual({ cron: '0 9 * * 1', timezone: 'UTC' });
  });
});

describe('bindAnswers', () => {
  it('preserves type for a whole-string binding', () => {
    // A connector param declared `number` rejects "3"; an embedded binding is
    // text by definition. Both cases have to be right or half the catalogue's
    // inputs fail schema validation at run time.
    const bound = bindAnswers(
      { limit: '{{setup.limit}}', note: 'top {{setup.limit}} rows' },
      { limit: 3 },
    );
    expect(bound.limit).toBe(3);
    expect(bound.note).toBe('top 3 rows');
  });

  it('reaches a schedule answer\'s timezone', () => {
    const bound = bindAnswers(
      { cron: '{{setup.when}}', tz: '{{setup.when.timezone}}' },
      { when: { cron: '0 9 * * 1', timezone: 'Europe/London' } },
    );
    expect(bound).toEqual({ cron: '0 9 * * 1', tz: 'Europe/London' });
  });

  it('renders an unanswered binding as empty rather than leaving the token', () => {
    expect(bindAnswers({ a: 'x{{setup.nope}}y' }, {})).toEqual({ a: 'xy' });
  });

  it('finds every referenced binding, however deeply nested', () => {
    expect(referencedBindings({ a: [{ b: { c: '{{setup.one}} {{setup.two}}' } }] }).sort())
      .toEqual(['one', 'two']);
  });
});

describe('the kind registry', () => {
  it('lets a registration replace a kind\'s rules without touching the parser', () => {
    // The extension point, exercised. A spec registered from outside is used by
    // the parser, the validator and the resolver alike — which is the property
    // that makes a `switch` in each of them the wrong shape.
    const original = guidedStepKindSpec('connect')!;
    try {
      registerGuidedStepKind<Extract<GuidedStep, { kind: 'connect' }>>({
        kind: 'connect',
        parse: (raw, base) => ({ ...base, kind: 'connect', connector: String(raw.connector ?? ''), why: '' }),
        validateAnswer: () => null,
        isSatisfied: () => true,
      });
      expect(registeredStepKinds()).toContain('connect');
      const plan = resolveGuidedPlan(
        parseGuidedSteps([{ id: 'c', kind: 'connect', title: 'C', connector: 'x' }]).steps,
        {},
        state(),
      );
      // The replacement's rule wins: satisfied with nothing connected.
      expect(plan.steps[0]!.satisfied).toBe(true);
    } finally {
      registerGuidedStepKind(original);
    }
  });
});
