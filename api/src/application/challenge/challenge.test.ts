/**
 * Challenge-pipeline tests: brief → spec → blueprint → plan.
 *
 * The Twilio trial email that prompted this feature is used verbatim as the
 * fixture. It is the honest test of the claim being made — "paste a brief like
 * this and the platform builds the system" — and it exercises the pipeline's
 * hardest inference: that four products which the brief never calls webhooks
 * nonetheless require an endpoint that RECEIVES.
 */
import { describe, it, expect } from 'vitest';
import { heuristicSpec, parseBrief } from './parseBrief';
import { normalizeCapability, normalizeCapabilities, scoreBlueprint, MATCH_THRESHOLD } from './blueprint';
import { matchBlueprint, twilioOmnichannelBlueprint, genericBlueprint } from './blueprints';
import { planChallenge } from './planChallenge';
import { parseHandlerSpec } from '../backend/handlerSpec';

const TWILIO_BRIEF = `Hi there,

Your account is live. Your 30-day trial is for testing the products. Upgrading is
when you actually start building: buying numbers, setting up senders, and
integrating Twilio into your own app.

Test all four products directly in the Console. No SDK install, no auth setup, no
integration work yet. Your trial covers 100 SMS, 75 voice minutes, 3,000 emails,
and 100 WhatsApp messages over 30 days.

SMS. Order notifications, two-way customer support, marketing campaigns.
Voice. IVR, click-to-call, call tracking, automated outbound dialing.
Email. Password resets, receipts, user onboarding, re-engagement campaigns.
WhatsApp. Conversational support, order updates, interactive surveys.

Team Twilio`;

describe('capability normalisation', () => {
  it('maps prose onto the closed vocabulary', () => {
    expect(normalizeCapability('text messaging')).toBe('sms');
    expect(normalizeCapability('phone tree')).toBe('ivr');
    expect(normalizeCapability('Whats App')).toBe('whatsapp');
    expect(normalizeCapability('click-to-call')).toBe('voice');
  });

  it('passes a vocabulary term through unchanged', () => {
    expect(normalizeCapability('inbound-webhook')).toBe('inbound-webhook');
  });

  it('returns null for something outside the vocabulary', () => {
    expect(normalizeCapability('quantum teleportation')).toBeNull();
  });

  it('dedupes and drops non-strings', () => {
    expect(normalizeCapabilities(['sms', 'text messaging', 42, 'nonsense-xyz'])).toEqual(['sms']);
  });
});

describe('heuristicSpec (the no-LLM floor)', () => {
  const spec = heuristicSpec(TWILIO_BRIEF);

  it('finds all four products without a model', () => {
    expect(spec.capabilities).toEqual(expect.arrayContaining(['sms', 'voice', 'ivr', 'email', 'whatsapp']));
  });

  it('infers that the system must RECEIVE, which the brief never says', () => {
    // This is the inference that decides a backend is needed at all.
    expect(spec.capabilities).toContain('inbound-webhook');
  });

  it('recognises the vendor', () => {
    expect(spec.integrations).toContain('Twilio');
    expect(spec.sponsor).toBe('Twilio');
  });

  it('quotes the trial allowances verbatim rather than paraphrasing them', () => {
    const quota = spec.constraints.find((c) => c.includes('100 SMS'));
    expect(quota).toBeTruthy();
    expect(quota).toContain('75 voice minutes');
    expect(quota).toContain('3,000 emails');
  });

  it('never returns an empty-handed spec, even for a one-liner', () => {
    const tiny = heuristicSpec('Build something.');
    expect(tiny.title).toBeTruthy();
    expect(tiny.goal).toBeTruthy();
  });
});

describe('parseBrief', () => {
  it('unions the model reading with the heuristic one rather than replacing it', async () => {
    const spec = await parseBrief(TWILIO_BRIEF, async () =>
      JSON.stringify({
        title: 'Twilio omnichannel trial build',
        sponsor: 'Twilio',
        goal: 'Build a customer communications system across SMS, Voice, Email and WhatsApp.',
        capabilities: ['sms', 'dashboard'],
        integrations: ['Twilio', 'SendGrid'],
        deliverables: ['A working demo'],
        constraints: [],
        successCriteria: ['A text gets a reply'],
      }),
    );

    expect(spec.title).toBe('Twilio omnichannel trial build');
    // From the model…
    expect(spec.capabilities).toContain('dashboard');
    expect(spec.integrations).toContain('SendGrid');
    // …and still everything the heuristic found.
    expect(spec.capabilities).toEqual(expect.arrayContaining(['voice', 'ivr', 'whatsapp', 'inbound-webhook']));
    expect(spec.constraints.some((c) => c.includes('100 SMS'))).toBe(true);
  });

  it('degrades to the heuristic when the model throws', async () => {
    const spec = await parseBrief(TWILIO_BRIEF, async () => { throw new Error('gateway down'); });
    expect(spec.capabilities).toContain('sms');
  });

  it('degrades to the heuristic when the model returns junk', async () => {
    const spec = await parseBrief(TWILIO_BRIEF, async () => 'I am sorry, I cannot do that.');
    expect(spec.capabilities).toContain('voice');
  });
});

describe('blueprint matching', () => {
  it('routes the Twilio brief to the Twilio blueprint', () => {
    const spec = heuristicSpec(TWILIO_BRIEF);
    const { chosen } = matchBlueprint(spec.capabilities, TWILIO_BRIEF);
    expect(chosen.blueprint.key).toBe('twilio-omnichannel');
    expect(chosen.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('falls back to generic for an unrelated brief rather than forcing a wrong fit', () => {
    const brief = 'Build an internal tool that imports CSV invoices and reconciles them against payments.';
    const spec = heuristicSpec(brief);
    const { chosen } = matchBlueprint(spec.capabilities, brief);
    expect(chosen.blueprint.key).toBe('generic');
  });

  it('reports why, including the runners-up', () => {
    const spec = heuristicSpec(TWILIO_BRIEF);
    const { chosen, considered } = matchBlueprint(spec.capabilities, TWILIO_BRIEF);
    expect(chosen.reasons.join(' ')).toContain('twilio');
    expect(considered.length).toBeGreaterThan(0);
  });

  it('does not penalise a blueprint for covering more than was asked', () => {
    const narrow = scoreBlueprint(twilioOmnichannelBlueprint, ['sms'], 'twilio sms');
    expect(narrow.matchedCapabilities).toEqual(['sms']);
    expect(narrow.missingCapabilities).toEqual([]);
  });
});

describe('the Twilio blueprint itself', () => {
  it('ships handlers that all parse', () => {
    for (const [name, raw] of Object.entries(twilioOmnichannelBlueprint.handlers)) {
      const parsed = parseHandlerSpec(raw, name);
      expect(parsed.ok, `${name}: ${parsed.ok ? '' : parsed.reason}`).toBe(true);
    }
  });

  it('signature-verifies every Twilio-facing endpoint', () => {
    // An unverified endpoint here would let anyone forge a customer and spend the
    // account's balance on the reply.
    for (const [name, raw] of Object.entries(twilioOmnichannelBlueprint.handlers)) {
      expect((raw as { verify: string }).verify, name).toBe('twilio');
    }
  });

  it('covers all four products in the brief', () => {
    const routes = Object.values(twilioOmnichannelBlueprint.handlers).map((h) => (h as { route: string }).route);
    expect(routes).toEqual(expect.arrayContaining(['/sms', '/voice', '/ivr', '/whatsapp', '/status']));
  });

  it('answers a status callback with nothing, not with TwiML', () => {
    const status = twilioOmnichannelBlueprint.handlers['message-status'] as { respond: { kind: string } };
    expect(status.respond.kind).toBe('empty');
  });

  it('declares the auth token it verifies against', () => {
    expect(twilioOmnichannelBlueprint.requiredSecrets.map((s) => s.name)).toContain('TWILIO_AUTH_TOKEN');
  });

  it('only calls connector actions that exist', async () => {
    const { BUILTIN_CONNECTORS } = await import('../connectors/defaults');
    for (const [name, raw] of Object.entries(twilioOmnichannelBlueprint.handlers)) {
      const parsed = parseHandlerSpec(raw, name);
      if (!parsed.ok) continue;
      for (const step of parsed.spec.steps) {
        if (step.kind !== 'connector') continue;
        const manifest = BUILTIN_CONNECTORS.get(step.connector);
        expect(manifest, `${name} → ${step.connector}`).toBeTruthy();
        expect(manifest!.actions.some((a) => a.key === step.actionKey), `${name} → ${step.connector}.${step.actionKey}`).toBe(true);
      }
    }
  });
});

describe('the generic blueprint', () => {
  it('ships a parseable health endpoint so a new workspace is provably reachable', () => {
    const parsed = parseHandlerSpec(genericBlueprint.handlers.health, 'health');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.spec.route).toBe('/health');
      expect(parsed.spec.verify).toBe('none');
    }
  });
});

describe('planChallenge', () => {
  it('uses the blueprint verbatim and does not call the model on a matched brief', async () => {
    const spec = heuristicSpec(TWILIO_BRIEF);
    let called = false;
    const plan = await planChallenge(spec, TWILIO_BRIEF, async () => { called = true; return '{}'; });

    expect(called).toBe(false);
    expect(plan.blueprintKey).toBe('twilio-omnichannel');
    expect(Object.keys(plan.handlers)).toHaveLength(Object.keys(twilioOmnichannelBlueprint.handlers).length);
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.requiredConnectors.map((c) => c.key)).toEqual(expect.arrayContaining(['twilio', 'sendgrid']));
  });

  it('prefers the brief’s own success criteria over the blueprint’s when it has them', async () => {
    const spec = { ...heuristicSpec(TWILIO_BRIEF), successCriteria: ['Judge can text the number and get a reply'] };
    const plan = await planChallenge(spec, TWILIO_BRIEF);
    expect(plan.successCriteria).toEqual(['Judge can text the number and get a reply']);
  });

  const genericBrief = 'Build an internal tool that reconciles CSV invoices against payments and emails a summary.';

  it('accepts a well-formed generated handler on the generic path', async () => {
    const spec = heuristicSpec(genericBrief);
    const plan = await planChallenge(spec, genericBrief, async () =>
      JSON.stringify({
        summary: 'Reconciliation service',
        handlers: [{
          name: 'reconcile',
          route: '/reconcile',
          method: 'POST',
          verify: 'shared-secret',
          steps: [{ kind: 'llm', id: 'summary', prompt: 'Summarise {{body.rows}}' }],
          respond: { kind: 'json', body: { summary: '{{steps.summary}}' } },
        }],
        tasks: [{ title: 'Wire the upstream webhook', description: 'Point the finance system at the endpoint.' }],
        connectors: ['sendgrid'],
        secrets: [{ name: 'WEBHOOK_SHARED_SECRET', label: 'Shared secret', where: 'Generated by you' }],
      }),
    );

    expect(plan.blueprintKey).toBe('generic');
    expect(Object.keys(plan.handlers)).toContain('reconcile');
    expect(plan.handlerWarnings).toHaveLength(0);
    expect(plan.requiredConnectors.map((c) => c.key)).toContain('sendgrid');
    expect(plan.tasks.some((t) => t.title === 'Wire the upstream webhook')).toBe(true);
  });

  it('drops a generated handler that names a connector action which does not exist', async () => {
    // A hallucinated action parses perfectly and fails on a live call.
    const spec = heuristicSpec(genericBrief);
    const plan = await planChallenge(spec, genericBrief, async () =>
      JSON.stringify({
        handlers: [{
          name: 'bad',
          route: '/bad',
          method: 'POST',
          verify: 'none',
          steps: [{ kind: 'connector', id: 's', connector: 'twilio', action: 'send_voicemail' }],
          respond: { kind: 'empty' },
        }],
      }),
    );

    expect(Object.keys(plan.handlers)).not.toContain('bad');
    expect(plan.handlerWarnings.join(' ')).toContain('send_voicemail');
  });

  it('drops a generated handler with no verify declaration', async () => {
    const spec = heuristicSpec(genericBrief);
    const plan = await planChallenge(spec, genericBrief, async () =>
      JSON.stringify({ handlers: [{ name: 'open', route: '/open', method: 'POST', steps: [], respond: { kind: 'empty' } }] }),
    );
    expect(Object.keys(plan.handlers)).not.toContain('open');
    expect(plan.handlerWarnings.join(' ')).toContain('verify');
  });

  it('adds TWILIO_AUTH_TOKEN when a generated handler verifies Twilio but forgot to ask for it', async () => {
    const spec = heuristicSpec(genericBrief);
    const plan = await planChallenge(spec, genericBrief, async () =>
      JSON.stringify({
        handlers: [{ name: 'sms', route: '/sms', method: 'POST', verify: 'twilio', steps: [], respond: { kind: 'empty' } }],
        secrets: [],
      }),
    );
    expect(plan.requiredSecrets.map((s) => s.name)).toContain('TWILIO_AUTH_TOKEN');
  });

  it('degrades to the skeleton, with a warning, when the design step fails', async () => {
    const spec = heuristicSpec(genericBrief);
    const plan = await planChallenge(spec, genericBrief, async () => { throw new Error('gateway down'); });
    expect(plan.blueprintKey).toBe('generic');
    expect(Object.keys(plan.handlers)).toContain('health');
    expect(plan.handlerWarnings).toHaveLength(1);
  });
});
