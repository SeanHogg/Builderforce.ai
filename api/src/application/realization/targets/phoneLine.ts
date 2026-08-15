/**
 * `phone-line` — a number customers can call, and a system that can call them.
 *
 * Both directions, because a business asking for "an automated phone system"
 * always means both and usually only gets one. Inbound is an answering system
 * that listens and replies; outbound is a campaign endpoint that places a call
 * and hands it the same brain. They share the reply route deliberately: two
 * scripts drift, and the drift shows up as a caller who is answered well when
 * they ring in and badly when they are rung.
 *
 * ── WHY SPEECH AND NOT A DIGIT MENU ─────────────────────────────────────────
 * `<Gather input="speech">` gives the transcript in `SpeechResult`, which a model
 * step can answer directly. A digit menu would need equality branching, which
 * the handler vocabulary deliberately does not have (`when` tests emptiness, not
 * equality) — and a phone tree is the thing everyone building this is trying to
 * get away from. DTMF is still accepted as a fallback for callers on a bad line.
 *
 * ── THE THREE FACTS MODELS GET WRONG HERE, PINNED ───────────────────────────
 * 1. `verify: 'twilio'` on EVERY Twilio-facing route. An unverified voice webhook
 *    lets anyone place calls on the account's balance.
 * 2. An outbound call needs `Url` OR inline `Twiml`, never both — this uses `Url`
 *    and points it at a route in this same system, so the outbound leg is
 *    debuggable in the same place as the inbound one.
 * 3. The status callback answers 204 with no body. Returning TwiML to a status
 *    callback is not an error Twilio reports; it is an error you find later in
 *    the logs, if you look.
 */

import { renderOpsConsole } from '../../challenge/blueprints/opsConsole';
import { audienceOf, criteriaFrom, goalHeadline } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

/** How long the gather waits before deciding the caller has stopped speaking. */
const SPEECH_TIMEOUT = 3;

export const phoneLineTarget: RealizationTarget = {
  key: 'phone-line',
  name: 'Phone line',
  summary: 'An inbound number that answers and understands, plus an endpoint that places outbound calls.',
  answers: 'Can customers reach this by phone — and can it reach them?',
  fidelity: 4,
  effort: 3,
  suits: ['voice', 'ivr', 'sms', 'notifications', 'ai-agent'],
  strategy: 'declarative',

  build(ctx: RealizeContext): RealizationOutput {
    const { spec } = ctx;
    const greeting = `Thanks for calling ${spec.title}. Tell me what you need and I'll help.`;
    const persona = [
      `You answer the phone for ${spec.title}.`,
      spec.goal.slice(0, 400),
      'You are speaking OUT LOUD to someone on a phone call. Two sentences at most.',
      'No lists, no markdown, no spelling anything out unless asked.',
      'If you do not know, say so and offer to take a message — never invent a price, a date or a policy.',
    ].join(' ');

    const routes = [
      { label: 'Incoming calls', path: '/voice' },
      { label: 'Caller said something', path: '/voice/reply' },
      { label: 'Outbound call, when it connects', path: '/voice/outbound' },
      { label: 'Call status callbacks', path: '/voice/status' },
      { label: 'Incoming SMS', path: '/sms' },
      { label: 'Place an outbound call', path: '/campaign/call' },
    ];

    return {
      summary: 'A phone number that answers, understands and replies — and a signed endpoint that places outbound calls onto the same brain.',
      files: {
        'phone.html': renderOpsConsole({
          title: `${spec.title} — phone line`,
          subtitle: 'Paste each URL into the matching field in the Twilio console. A route that shows "no handler" is not live.',
          targetLabel: 'Point Twilio at',
          routes,
          meters: [
            { label: 'Calls this month', allowance: 500 },
            { label: 'Messages this month', allowance: 1000 },
          ],
        }),
        'phone-line/runbook.md': `# ${spec.title} — phone line runbook

## Wiring it up

1. Buy or pick a number in the Twilio console.
2. **Voice → A call comes in** → Webhook, POST → \`<ingress>/voice\`
3. **Voice → Call status changes** → \`<ingress>/voice/status\`
4. **Messaging → A message comes in** → Webhook, POST → \`<ingress>/sms\`
5. Store \`TWILIO_AUTH_TOKEN\` in the project's secret vault. Until it is there
   every route answers **403** — correct, and the single most common reason a
   freshly wired line "does nothing".

\`phone.html\` shows the exact URLs and whether each one is actually serving.

## Placing outbound calls

\`POST <ingress>/campaign/call\` with a signed body:

\`\`\`json
{ "to": "+14155551234", "from": "+1<your Twilio number>" }
\`\`\`

Signed with \`WEBHOOK_SHARED_SECRET\` — HMAC-SHA256 over the raw body, hex, in the
\`X-Builderforce-Signature\` header. It is signed because an unauthenticated
endpoint that places phone calls is an unauthenticated endpoint that spends money,
and it will be found.

The call connects to \`/voice/outbound\`, which greets and then hands over to the
same reply route the inbound line uses. One brain, both directions.

## Before it talks to a stranger

- [ ] Call it yourself. Twice. Once saying something it expects, once saying
      something it does not.
- [ ] Check the recording and transcription settings against the law where your
      callers are — one-party and two-party consent are different countries.
- [ ] Decide what happens when it cannot help. "Let me take a message" is an
      answer; a silent pause is a hang-up.
- [ ] Outbound calling is regulated. Calling hours, consent and do-not-call
      obligations are not features you add later.

## What good sounds like

Two sentences per turn. Anything longer and the caller talks over it, the gather
cuts, and the transcript arrives as a fragment — which reads as the model being
stupid when it is the script being long.
`,
      },
      handlers: {
        'voice-inbound': {
          name: 'voice-inbound',
          route: '/voice',
          method: 'POST',
          verify: 'twilio',
          description: 'Answers an incoming call and listens for what the caller wants.',
          steps: [],
          respond: {
            kind: 'twiml',
            twiml: [
              {
                gather: {
                  action: '{{project.ingressUrl}}/voice/reply',
                  input: 'speech dtmf',
                  timeout: SPEECH_TIMEOUT,
                  prompts: [{ say: greeting }],
                },
              },
              // Reached only when the caller says nothing at all. Without it the
              // call ends silently, which the caller hears as a hang-up.
              { say: "I didn't catch that. Please call back and I'll try again." },
              { hangup: true },
            ],
          },
        },

        'voice-reply': {
          name: 'voice-reply',
          route: '/voice/reply',
          method: 'POST',
          verify: 'twilio',
          description: 'Answers what the caller said, then listens again. Shared by the inbound and outbound legs.',
          steps: [
            {
              kind: 'llm',
              id: 'answer',
              system: persona,
              prompt: 'The caller said: {{body.SpeechResult}}{{body.Digits}}',
              maxTokens: 160,
              temperature: 0.3,
            },
          ],
          respond: {
            kind: 'twiml',
            twiml: [
              {
                gather: {
                  action: '{{project.ingressUrl}}/voice/reply',
                  input: 'speech dtmf',
                  timeout: SPEECH_TIMEOUT,
                  // A failing step binds empty, so the fallback text is part of
                  // the template rather than a branch: a model outage becomes a
                  // slightly unhelpful call, not a dropped one.
                  prompts: [{ say: '{{steps.answer}}' }, { say: 'Anything else?' }],
                },
              },
              { say: 'Thanks for calling. Goodbye.' },
              { hangup: true },
            ],
          },
        },

        'voice-outbound': {
          name: 'voice-outbound',
          route: '/voice/outbound',
          method: 'POST',
          verify: 'twilio',
          description: 'What an outbound call says when the person picks up, before handing to the shared reply route.',
          steps: [],
          respond: {
            kind: 'twiml',
            twiml: [
              {
                gather: {
                  action: '{{project.ingressUrl}}/voice/reply',
                  input: 'speech dtmf',
                  timeout: SPEECH_TIMEOUT,
                  prompts: [
                    {
                      say: `Hello, this is ${spec.title} calling. ${goalHeadline(spec)} Is now a good time?`,
                    },
                  ],
                },
              },
              { say: "I'll try again another time. Goodbye." },
              { hangup: true },
            ],
          },
        },

        'voice-status': {
          name: 'voice-status',
          route: '/voice/status',
          // ANY: Twilio's status callbacks are POST today and the verb is not
          // something this system should be pinned to.
          method: 'ANY',
          verify: 'twilio',
          description: 'Call status callbacks. Answers 204 with no body — TwiML here is silently wrong.',
          steps: [],
          respond: { kind: 'empty', status: 204 },
        },

        'sms-inbound': {
          name: 'sms-inbound',
          route: '/sms',
          method: 'POST',
          verify: 'twilio',
          description: 'Answers an incoming text message.',
          steps: [
            {
              kind: 'llm',
              id: 'reply',
              system: `${persona} This one is a TEXT message, so write it as a text: one or two lines, no greeting, no sign-off.`,
              prompt: '{{body.Body}}',
              maxTokens: 200,
              temperature: 0.3,
            },
          ],
          respond: {
            kind: 'twiml',
            twiml: [{ message: '{{steps.reply}}' }],
          },
        },

        'campaign-call': {
          name: 'campaign-call',
          route: '/campaign/call',
          method: 'POST',
          // Signed, not open. An endpoint that places phone calls is an endpoint
          // that spends money, and a public one will be found.
          verify: 'shared-secret',
          description: 'Places an outbound call. Signed with WEBHOOK_SHARED_SECRET.',
          steps: [
            {
              kind: 'connector',
              id: 'placed',
              connector: 'twilio',
              action: 'make_call',
              input: {
                To: '{{body.to}}',
                From: '{{body.from}}',
                // Url, not inline Twiml — Twilio accepts exactly one, and a URL
                // into this same system means the outbound leg is debuggable
                // beside the inbound one.
                Url: '{{project.ingressUrl}}/voice/outbound',
                StatusCallback: '{{project.ingressUrl}}/voice/status',
              },
            },
          ],
          respond: {
            kind: 'json',
            body: { placed: '{{steps.placed}}' },
          },
        },
      },
      tasks: [
        {
          order: 10,
          title: 'Connect Twilio and buy a number',
          description:
            'Connect the Twilio integration, then buy or choose a voice-and-SMS-capable number. Nothing on this line answers until there is a number pointing at it.',
          kind: 'setup',
        },
        {
          order: 20,
          title: 'Store TWILIO_AUTH_TOKEN in the project secret vault',
          description:
            'Every voice and SMS route verifies Twilio\'s signature, and without the token they all answer 403. This is the single most common reason a freshly wired phone line appears to do nothing at all.',
          kind: 'setup',
        },
        {
          order: 30,
          title: 'Paste the four webhook URLs into the Twilio console',
          description:
            'Open phone.html for the exact addresses: incoming call, call status, incoming message, and the outbound-answer URL. Each row shows whether that route is actually serving.',
          kind: 'setup',
        },
        {
          order: 40,
          title: 'Store WEBHOOK_SHARED_SECRET before using /campaign/call',
          description:
            'The outbound endpoint verifies an HMAC-SHA256 signature over the raw body in X-Builderforce-Signature. Until the secret exists it fails closed — which is the right state for an endpoint that places calls.',
          kind: 'setup',
        },
        {
          order: 50,
          title: 'Rewrite the greeting and the persona in your own words',
          description:
            'Both are generated from the brief and both are heard out loud. Read them aloud once — anything you would not say to a customer on the phone is wrong, and two sentences is the ceiling before the caller talks over it.',
          kind: 'build',
        },
        {
          order: 60,
          title: 'Call it twice, then check the regulatory list in the runbook',
          description:
            'Once saying something it expects, once saying something it does not. Then work through phone-line/runbook.md: recording consent, calling hours and do-not-call are obligations, not later features.',
          kind: 'setup',
        },
      ],
      requiredConnectors: [
        {
          key: 'twilio',
          label: 'Twilio',
          why: `The phone line places outbound calls through Twilio and answers inbound ones on a Twilio number. Every route here fails closed until a connection exists — which is what stops a half-configured line from silently accepting calls from ${audienceOf(spec)}.`,
        },
      ],
      requiredSecrets: [
        {
          name: 'TWILIO_AUTH_TOKEN',
          label: 'Twilio auth token',
          where: 'Twilio Console → Account Info. Required to verify inbound webhook signatures; without it every voice and SMS route answers 403.',
        },
        {
          name: 'WEBHOOK_SHARED_SECRET',
          label: 'Outbound campaign signing secret',
          where: 'Invent a long random string. The caller of /campaign/call signs the raw request body with it (HMAC-SHA256, hex, X-Builderforce-Signature).',
        },
      ],
      requiredCollections: [],
      successCriteria: criteriaFrom(spec, [
        'A real phone call to the number is answered, understood and replied to.',
        'An SMS to the number gets a useful reply.',
        'A signed POST to /campaign/call places a call that greets the recipient and then converses.',
        'The recording-consent, calling-hours and do-not-call questions in the runbook have written answers.',
      ]),
    };
  },
};
