/**
 * Realization — the catalog contract, the recommender's opinion, and the
 * invariants each proof depends on to be worth running.
 *
 * The assertions worth having here are not "the HTML contains a div". They are
 * the things that make a proof EVIDENCE rather than a page: that a target which
 * collects data declares the collection it writes to (or its first submission is
 * lost), that a proof with a form does not publish its own charter to the public
 * internet, that the recommender prefers the cheap answer, and that a page which
 * has to reach its own backend spells the substitution the materialiser is
 * looking for.
 */
import { describe, it, expect } from 'vitest';
import type { ChallengeSpec } from '../challenge/parseBrief';
import { INGRESS_EXPRESSION } from './proofShell';
import { planRealization, strategyFor } from './planRealization';
import { isPublishablePath } from './realizeService';
import { REALIZATION_KEYS, type RealizationTarget } from './realizationTarget';
import { REALIZATION_TARGETS, realizationTargetByKey, recommendRealizations } from './targets';

function spec(over: Partial<ChallengeSpec> = {}): ChallengeSpec {
  return {
    title: 'Acme Concierge',
    sponsor: 'Acme operations',
    goal: 'Answer customer questions about orders without a person reading every message.',
    capabilities: ['sms', 'voice', 'ai-agent'],
    integrations: ['twilio'],
    constraints: ['Two people currently answer everything by hand.'],
    successCriteria: ['Half of all questions answered without a human.'],
    ...over,
  } as ChallengeSpec;
}

const INGRESS = 'https://api.test/hooks/tok';

describe('the catalog', () => {
  it('declares exactly the keys the type does', () => {
    expect(REALIZATION_TARGETS.map((t) => t.key).sort()).toEqual([...REALIZATION_KEYS].sort());
  });

  it('is resolvable by key, and rejects anything else', () => {
    for (const key of REALIZATION_KEYS) expect(realizationTargetByKey(key)?.key).toBe(key);
    expect(realizationTargetByKey('not-a-target')).toBeNull();
    expect(realizationTargetByKey(null)).toBeNull();
  });

  it('orders the registry by fidelity, because that is the order to walk them', () => {
    const fidelities = REALIZATION_TARGETS.map((t) => t.fidelity);
    expect([...fidelities].sort((a, b) => a - b)).toEqual(fidelities);
  });
});

describe.each(REALIZATION_TARGETS.map((t) => [t.key, t] as const))('%s', (_key, target: RealizationTarget) => {
  const output = target.build({ spec: spec(), ingressUrl: INGRESS });

  it('states what it will produce and what would make it a success', () => {
    expect(output.summary.trim().length).toBeGreaterThan(20);
    // A proof with no criterion is a page. Every one of these has to state what
    // would have to be true for the money spent on it to have bought something.
    expect(output.successCriteria.length).toBeGreaterThanOrEqual(2);
  });

  it('produces something — a file or a handler', () => {
    expect(Object.keys(output.files).length + Object.keys(output.handlers).length).toBeGreaterThan(0);
  });

  it('seeds tickets that each say who does them', () => {
    expect(output.tasks.length).toBeGreaterThan(0);
    for (const task of output.tasks) {
      // Absent means `setup`, and a wrong `build` spends an agent run on an
      // instruction only a human can follow — so every seeded ticket is explicit.
      expect(['setup', 'build'], task.title).toContain(task.kind);
      expect(task.description.length, task.title).toBeGreaterThan(30);
    }
  });

  it('declares every collection its forms post to', () => {
    // The failure this prevents: a landing page whose collection was never
    // created reports ZERO demand for an idea people wanted, because
    // `/__api/collections/<name>` 404s identically for missing and closed.
    const markup = Object.values(output.files).join('\n');
    const posted = [...markup.matchAll(/__api\/collections\/([a-z0-9-]+)/g)].map((m) => m[1]!);
    for (const name of new Set(posted)) {
      expect(output.requiredCollections, `${name} is written to but never declared`).toContain(name);
    }
  });

  it('spells the ingress substitution exactly as the materialiser rewrites it', () => {
    // `materializeChallenge` replaces this literal when it writes a file. A page
    // that wrote its own variant keeps the empty fallback and ships a console
    // that can never reach its own handlers.
    for (const [path, content] of Object.entries(output.files)) {
      if (!content.includes('__INGRESS_URL__')) continue;
      expect(content, path).toContain(INGRESS_EXPRESSION);
    }
  });

  it('never puts a working document on the public site', () => {
    // Charters, runbooks and hypothesis files hold exit criteria, on-call names
    // and thresholds. They are for the team; the site is for the world.
    for (const path of Object.keys(output.files)) {
      if (path.endsWith('.md')) expect(isPublishablePath(path), path).toBe(false);
    }
  });

  it('asks for a connector only with a reason a person can act on', () => {
    for (const connector of output.requiredConnectors) {
      expect(connector.why.length, connector.key).toBeGreaterThan(40);
    }
    for (const secret of output.requiredSecrets) {
      expect(secret.where.length, secret.name).toBeGreaterThan(20);
    }
  });
});

describe('handler safety', () => {
  it('never exposes a spend-money endpoint without verification', () => {
    // The one invariant a generated proof cannot be allowed to relax: an
    // unverified public endpoint that places a call or sends a message spends
    // the account's balance for whoever finds the URL.
    for (const target of REALIZATION_TARGETS) {
      const output = target.build({ spec: spec(), ingressUrl: INGRESS });
      for (const [name, raw] of Object.entries(output.handlers)) {
        const handler = raw as { verify?: string; steps?: Array<{ kind?: string }> };
        const spends = (handler.steps ?? []).some((s) => s.kind === 'connector');
        if (spends) expect(handler.verify, `${target.key}/${name}`).not.toBe('none');
      }
    }
  });

  it('declares a verification kind on every handler, never leaving it to default', () => {
    for (const target of REALIZATION_TARGETS) {
      const output = target.build({ spec: spec(), ingressUrl: INGRESS });
      for (const [name, raw] of Object.entries(output.handlers)) {
        expect((raw as { verify?: string }).verify, `${target.key}/${name}`).toBeTruthy();
      }
    }
  });
});

describe('the recommender', () => {
  it('returns every target, because this is advice and not a filter', () => {
    expect(recommendRealizations(spec())).toHaveLength(REALIZATION_TARGETS.length);
  });

  it('recommends exactly one', () => {
    expect(recommendRealizations(spec()).filter((r) => r.recommended)).toHaveLength(1);
  });

  it('prefers a cheap proof over an expensive one', () => {
    // The whole opinion of the feature: the expensive failure is not building
    // the wrong thing slowly, it is building the right-LOOKING thing before
    // finding out whether anyone wanted it.
    const top = recommendRealizations(spec()).find((r) => r.recommended)!;
    expect(realizationTargetByKey(top.key)!.effort).toBeLessThanOrEqual(2);
  });

  it('never recommends the live system as the first move', () => {
    const briefs = [spec(), spec({ capabilities: [] }), spec({ capabilities: ['voice', 'ivr'] })];
    for (const s of briefs) {
      expect(recommendRealizations(s).find((r) => r.recommended)!.key).not.toBe('live-system');
    }
  });

  it('explains itself', () => {
    for (const recommendation of recommendRealizations(spec())) {
      expect(recommendation.reasons.length).toBeGreaterThan(0);
      expect(recommendation.reasons.some((r) => r.startsWith('Answers:'))).toBe(true);
    }
  });

  it('ranks the phone line higher for a brief that names voice than for one that does not', () => {
    const withVoice = recommendRealizations(spec({ capabilities: ['voice', 'ivr', 'sms'] }));
    const without = recommendRealizations(spec({ capabilities: ['payments', 'ecommerce'] }));
    const scoreOf = (list: typeof withVoice) => list.find((r) => r.key === 'phone-line')!.score;
    expect(scoreOf(withVoice)).toBeGreaterThan(scoreOf(without));
  });
});

describe('planRealization', () => {
  it('namespaces the key so a proof is never mistaken for a blueprint match', () => {
    const { plan } = planRealization(spec(), realizationTargetByKey('smoke-test')!, INGRESS);
    expect(plan.blueprintKey).toBe('realization:smoke-test');
  });

  it('gives a proof its own plan and NOT the system it stands in for', () => {
    // A smoke test that inherited the blueprint's handlers would deploy a webhook
    // backend to answer the question "does anyone want this?".
    const briefPlan = {
      blueprintKey: 'twilio-omnichannel',
      handlers: { 'inbound-sms': { verify: 'twilio' } },
      files: { 'console.html': '<html></html>' },
      tasks: [{ order: 1, title: 'Connect Twilio', description: 'x', kind: 'setup' as const }],
      requiredConnectors: [{ key: 'twilio', label: 'Twilio', why: 'x' }],
      requiredSecrets: [],
      successCriteria: ['An SMS is answered'],
      handlerWarnings: [],
    } as never;

    const { plan } = planRealization(spec(), realizationTargetByKey('smoke-test')!, INGRESS, { briefPlan });
    expect(plan.handlers['inbound-sms']).toBeUndefined();
    expect(plan.requiredConnectors).toHaveLength(0);
  });

  it('extends the brief plan for the live system, because that IS the system', () => {
    const briefPlan = {
      blueprintKey: 'twilio-omnichannel',
      handlers: { 'inbound-sms': { verify: 'twilio' } },
      files: {},
      tasks: [],
      requiredConnectors: [{ key: 'twilio', label: 'Twilio', why: 'x' }],
      requiredSecrets: [{ name: 'TWILIO_AUTH_TOKEN', label: 'x', where: 'y' }],
      successCriteria: ['An SMS is answered'],
      handlerWarnings: ['one handler was dropped'],
    } as never;

    const { plan } = planRealization(spec(), realizationTargetByKey('live-system')!, INGRESS, { briefPlan });
    expect(plan.handlers['inbound-sms']).toBeDefined();
    expect(plan.requiredConnectors.map((c) => c.key)).toContain('twilio');
    expect(plan.handlerWarnings).toContain('one handler was dropped');
    // The proof's own criteria lead — a list opening with the blueprint's would
    // bury the question this act is answering.
    expect(plan.successCriteria[0]).not.toBe('An SMS is answered');
  });

  it('returns the collections the service has to create', () => {
    expect(planRealization(spec(), realizationTargetByKey('smoke-test')!, INGRESS).collections).toContain('waitlist');
    expect(planRealization(spec(), realizationTargetByKey('demo-video')!, INGRESS).collections).toHaveLength(0);
  });
});

describe('strategyFor', () => {
  it('honours a cloud choice only where the target offers one', () => {
    expect(strategyFor(realizationTargetByKey('live-system')!, 'aws-lambda')).toBe('aws-lambda');
    // A clickable prototype has no backend at all; generating an AWS pipeline for
    // one HTML file is not what "deploy it to AWS" meant.
    expect(strategyFor(realizationTargetByKey('clickable-prototype')!, 'aws-lambda')).toBe('declarative');
    expect(strategyFor(realizationTargetByKey('smoke-test')!, 'gcp-cloudrun')).toBe('declarative');
  });

  it('ignores a strategy that is not one', () => {
    expect(strategyFor(realizationTargetByKey('live-system')!, 'wishful-thinking')).toBe('declarative');
  });
});

describe('what gets published', () => {
  it('publishes pages and assets', () => {
    for (const path of ['index.html', 'demand.html', 'demo/index.html', 'assets/app.js', 'logo.svg']) {
      expect(isPublishablePath(path), path).toBe(true);
    }
  });

  it('never publishes a handler spec or a generated backend bundle', () => {
    // `aws/src/engine.js` embeds the project's handler specs. Publishing it to a
    // public static site would hand every visitor the system's internal design.
    for (const path of ['handlers/inbound-sms.json', 'aws/src/engine.js', 'worker/src/engine.js', 'azure/engine.js', '.github/workflows/deploy.yml']) {
      expect(isPublishablePath(path), path).toBe(false);
    }
  });
});
