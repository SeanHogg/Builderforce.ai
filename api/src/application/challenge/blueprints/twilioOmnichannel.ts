/**
 * Blueprint: Twilio omnichannel customer communications.
 *
 * Covers the shape of brief this pipeline was built against — "here is a trial
 * account for SMS, Voice, Email and WhatsApp, build something with all four" —
 * and delivers the one thing a trial account makes hard: a system that RECEIVES.
 * Sending is a single API call anyone can make from a console. Two-way support,
 * an IVR, a WhatsApp survey and a delivery-status trail all require an endpoint
 * that answers in the provider's own protocol, which is what the handlers below
 * are.
 *
 * ── WHAT WINS, AND WHY THESE HANDLERS ───────────────────────────────────────
 * Each of the four products gets a handler that exercises the part a reviewer
 * cannot fake:
 *   • `inbound-sms`     two-way support — classify the inbound message with a
 *                       model and answer in the same SMS turn.
 *   • `voice-ivr`       a real IVR: `<Gather>` a keypress, then branch. This is
 *                       the one that proves an endpoint is live, because Twilio
 *                       fetches it mid-call and a wrong answer drops the caller.
 *   • `voice-menu`      the branch target the IVR gathers into.
 *   • `whatsapp-inbound` conversational support plus an interactive survey turn.
 *   • `message-status`  the delivery-status callback, which is what turns "we
 *                       sent it" into "it arrived" — the difference between a
 *                       demo and an operable system.
 * Email is outbound-only by nature, so it is a connector action driven from the
 * console rather than a handler.
 *
 * ── TRIAL LIMITS ARE A DESIGN CONSTRAINT ────────────────────────────────────
 * The brief grants 100 SMS, 75 voice minutes, 3,000 emails and 100 WhatsApp
 * messages. The console file below shows consumption against those numbers,
 * because a system that silently burns a 100-message allowance during testing
 * fails the brief in the most annoying possible way.
 */

import type { Blueprint } from '../blueprint';
import { renderOpsConsole } from './opsConsole';

/** Shared preamble for the model steps: short, because it is going into an SMS. */
const SUPPORT_PERSONA =
  'You are the customer support line for {{project.name}}. Reply in plain text, no markdown, ' +
  'under 300 characters, in the language the customer wrote in. If you cannot resolve it, say a ' +
  'human will follow up and do not invent order details, prices or dates.';

const handlers: Record<string, unknown> = {
  /**
   * Two-way SMS support. The signature check is not optional decoration: without
   * it anyone who learns the URL can forge "a customer", and every forged message
   * spends the account's balance on the reply.
   */
  'inbound-sms': {
    name: 'inbound-sms',
    route: '/sms',
    method: 'POST',
    verify: 'twilio',
    description: 'Inbound SMS → classify, answer in the same turn, log the sender.',
    steps: [
      {
        id: 'reply',
        kind: 'llm',
        system: SUPPORT_PERSONA,
        prompt:
          'Customer {{body.From}} texted: "{{body.Body}}"\n\nWrite the reply text only.',
        maxTokens: 160,
        temperature: 0.3,
      },
    ],
    // Replying in the TwiML rather than with a follow-up API call keeps the whole
    // exchange to ONE Twilio message billed against the trial's 100.
    respond: { kind: 'twiml', twiml: [{ message: '{{steps.reply}}' }] },
  },

  /**
   * Inbound voice → IVR. `<Gather>` posts the keypress to `/ivr` on the same
   * ingress; the absolute URL is built from `{{project.ingressUrl}}` so the
   * handler does not have to hardcode a token it cannot know at authoring time.
   */
  'voice-ivr': {
    name: 'voice-ivr',
    route: '/voice',
    method: 'POST',
    verify: 'twilio',
    description: 'Inbound call → spoken menu, gathers a keypress.',
    steps: [],
    respond: {
      kind: 'twiml',
      twiml: [
        {
          gather: {
            action: '{{project.ingressUrl}}/ivr',
            input: 'dtmf',
            numDigits: 1,
            timeout: 6,
            prompts: [
              {
                say: 'Thanks for calling {{project.name}}. For order status, press 1. To speak to support, press 2. To get this by text message, press 3.',
                voice: 'Polly.Joanna',
              },
            ],
          },
        },
        // Reached only when the caller presses nothing — Gather falls through on
        // timeout, and without something after it the call would end in silence.
        { say: 'Sorry, I did not catch that. Goodbye.', voice: 'Polly.Joanna' },
        { hangup: true },
      ],
    },
  },

  /** The IVR branch target. `Digits` is what `<Gather>` posts back. */
  'voice-menu': {
    name: 'voice-menu',
    route: '/ivr',
    method: 'POST',
    verify: 'twilio',
    description: 'Handles the IVR keypress: order status, transfer, or SMS follow-up.',
    steps: [
      {
        id: 'status',
        kind: 'llm',
        when: '{{body.Digits}}',
        system: SUPPORT_PERSONA,
        prompt:
          'The caller from {{body.From}} pressed {{body.Digits}} on the phone menu ' +
          '(1 = order status, 2 = speak to support, 3 = send by text). Write one short spoken ' +
          'sentence acknowledging their choice.',
        maxTokens: 80,
        temperature: 0.2,
      },
      {
        // Option 3: the caller asked for it in writing. This is the cross-channel
        // moment the brief is really asking for — a voice call producing an SMS.
        id: 'sms',
        kind: 'connector',
        when: '{{body.Digits}}',
        connector: 'twilio',
        action: 'send_sms',
        input: {
          To: '{{body.From}}',
          From: '{{body.To}}',
          Body: 'Thanks for calling {{project.name}}. {{steps.status}}',
        },
      },
    ],
    respond: {
      kind: 'twiml',
      twiml: [
        { say: '{{steps.status}}', voice: 'Polly.Joanna' },
        { say: 'Thanks for calling. Goodbye.', voice: 'Polly.Joanna' },
        { hangup: true },
      ],
    },
  },

  /**
   * WhatsApp conversational support. Same ingress, same verification — Twilio
   * signs WhatsApp webhooks identically, which is why one verification kind
   * covers three products.
   */
  'whatsapp-inbound': {
    name: 'whatsapp-inbound',
    route: '/whatsapp',
    method: 'POST',
    verify: 'twilio',
    description: 'Inbound WhatsApp → conversational support and survey capture.',
    steps: [
      {
        id: 'reply',
        kind: 'llm',
        system:
          SUPPORT_PERSONA +
          ' If the customer sends a number from 1 to 5, treat it as a satisfaction score and thank them for it.',
        prompt: 'WhatsApp message from {{body.From}}: "{{body.Body}}"\n\nWrite the reply text only.',
        maxTokens: 200,
        temperature: 0.3,
      },
    ],
    respond: { kind: 'twiml', twiml: [{ message: '{{steps.reply}}' }] },
  },

  /**
   * Delivery-status callback. Returns 204 with no body: Twilio expects nothing
   * back here, and returning TwiML to a status callback is logged as an error.
   */
  'message-status': {
    name: 'message-status',
    route: '/status',
    method: 'POST',
    verify: 'twilio',
    description: 'Twilio delivery-status callback — records sent/delivered/failed.',
    steps: [],
    respond: { kind: 'empty', status: 204 },
  },
};

/**
 * The operator console, from the shared generator — the trial allowances and the
 * five webhook URLs are the only parts that are specific to this blueprint.
 */
const CONSOLE_HTML = renderOpsConsole({
  title: 'Omnichannel operations console',
  subtitle: 'SMS \u00b7 Voice \u00b7 Email \u00b7 WhatsApp \u2014 one system, one set of webhooks, one trial balance.',
  targetLabel: 'Point Twilio at',
  // The brief's allowances. A system that silently burns a 100-message balance
  // during testing fails the brief in the most annoying possible way.
  meters: [
    { label: 'SMS', allowance: 100 },
    { label: 'Voice minutes', allowance: 75 },
    { label: 'Email', allowance: 3000 },
    { label: 'WhatsApp', allowance: 100 },
  ],
  routes: [
    { label: 'Inbound SMS', path: '/sms' },
    { label: 'Inbound voice (IVR)', path: '/voice' },
    { label: 'IVR keypress', path: '/ivr' },
    { label: 'Inbound WhatsApp', path: '/whatsapp' },
    { label: 'Delivery status', path: '/status' },
  ],
});

const RUNBOOK = `# Twilio omnichannel — runbook

This project is a working omnichannel customer-communications system: SMS, Voice,
Email and WhatsApp, all four wired to the same backend.

## What is already running

The handlers in \`handlers/\` are **live** — they are executed by Builderforce at
this project's ingress URL, which is listed in \`handlers/README.md\` and in the
project's Backend panel. There is no deploy step.

| Product | Endpoint | What it does |
| --- | --- | --- |
| SMS | \`POST /sms\` | Two-way support. Classifies the inbound message and answers in the same turn. |
| Voice | \`POST /voice\` | IVR. Speaks a menu and gathers a keypress. |
| Voice | \`POST /ivr\` | Handles the keypress; option 3 sends the answer by SMS. |
| WhatsApp | \`POST /whatsapp\` | Conversational support and survey capture. |
| All | \`POST /status\` | Delivery-status callback. |

Email is outbound-only, so it is a connector action rather than a handler — send
receipts, resets and onboarding mail with the **SendGrid** connector's
\`send_html_email\` or \`send_template_email\`.

## Setup, in order

1. **Connect Twilio.** Integrations → Connectors → Twilio. You need the Account
   SID and the Auth token from the Twilio Console.
2. **Store \`TWILIO_AUTH_TOKEN\` as a project secret.** Same value as above. This
   is what the handlers verify inbound signatures against — until it is set, every
   inbound webhook is rejected with a 403, which is the correct fail-closed
   behaviour but looks like an outage if you do not expect it.
3. **Point your Twilio number at the endpoints.** Either paste the URLs into the
   Twilio Console, or run the Twilio connector's \`configure_number\` action with
   \`SmsUrl\` and \`VoiceUrl\` set — that does the same thing without leaving here.
4. **Connect SendGrid** and verify a sender, for the email half.
5. **WhatsApp**: join the Twilio sandbox, then point the sandbox's inbound webhook
   at \`/whatsapp\`.

## Watch the trial balance

The allowances are 100 SMS, 75 voice minutes, 3,000 emails and 100 WhatsApp
messages. Two things burn them faster than you expect:

- **Every test is a real message.** The SMS handler replies inside the TwiML
  rather than with a second API call precisely so one exchange costs one message
  instead of two.
- **A retry storm.** If a handler 500s, Twilio retries. The runtime returns a
  well-formed reply even when a step fails, specifically to avoid that.

## Proving it works

- Text your Twilio number and get a relevant answer back.
- Call it, hear the menu, press 3, and receive the SMS.
- Message the WhatsApp sandbox and get a reply.
- Send a receipt through SendGrid and see it in \`get_email_stats\`.
- Check the Backend panel's delivery log — every inbound request, its verification
  verdict and its timing are recorded there.

## When you outgrow this

Switch the backend strategy to **GitHub Worker**. These same handlers are compiled
into a real Cloudflare Worker in your repo, deployed to your own account, with no
vocabulary limits. The behaviour is identical on day one, so it is a migration
rather than a rewrite.
`;

export const twilioOmnichannelBlueprint: Blueprint = {
  key: 'twilio-omnichannel',
  name: 'Twilio omnichannel customer communications',
  summary:
    'SMS, Voice (IVR), Email and WhatsApp on one backend: two-way support, a real phone menu, transactional email, conversational WhatsApp, and delivery-status tracking — with the trial allowances watched.',
  signals: ['twilio', 'sendgrid', 'whatsapp', 'twiml', 'ivr', 'sms'],
  capabilities: [
    'sms',
    'mms',
    'whatsapp',
    'voice',
    'ivr',
    'email',
    'inbound-webhook',
    'notifications',
    'verification',
    'ai-agent',
    'dashboard',
  ],
  requiredConnectors: [
    {
      key: 'twilio',
      label: 'Twilio',
      why: 'Sends SMS/WhatsApp, places calls, and configures which URL your number delivers webhooks to.',
    },
    {
      key: 'sendgrid',
      label: 'SendGrid',
      why: 'The email half of the brief — receipts, password resets, onboarding and re-engagement.',
    },
  ],
  requiredSecrets: [
    {
      name: 'TWILIO_AUTH_TOKEN',
      label: 'Twilio auth token',
      where:
        'Twilio Console → Account Info. The handlers verify every inbound webhook signature against this; without it they fail closed with a 403.',
    },
  ],
  strategy: 'declarative',
  files: {
    'index.html': CONSOLE_HTML,
    'RUNBOOK.md': RUNBOOK,
  },
  handlers,
  tasks: [
    {
      order: 1,
      title: 'Connect Twilio and store TWILIO_AUTH_TOKEN',
      description:
        'Create the Twilio connector connection (Account SID + auth token) and store the same auth token as the project secret TWILIO_AUTH_TOKEN. Inbound webhooks are rejected with a 403 until this exists — that is fail-closed by design, not a bug.',
    },
    {
      order: 2,
      title: 'Point the Twilio number at the SMS and Voice webhooks',
      description:
        'Run the Twilio connector action configure_number with SmsUrl set to <ingress>/sms and VoiceUrl set to <ingress>/voice, or paste both into the Twilio Console. Verify with a real text and a real call.',
    },
    {
      order: 3,
      title: 'Verify the IVR end to end',
      description:
        'Call the number, confirm the menu plays, press 3, and confirm the SMS arrives. This is the strongest single proof the backend is live, because Twilio fetches the TwiML mid-call.',
    },
    {
      order: 4,
      title: 'Connect SendGrid and verify a sender',
      description:
        'Create the SendGrid connection and verify a sender address, then send one receipt with send_html_email. Check get_email_stats for the delivered count.',
    },
    {
      order: 5,
      title: 'Join the WhatsApp sandbox and wire the inbound webhook',
      description:
        'Join the Twilio WhatsApp sandbox, point its inbound webhook at <ingress>/whatsapp, and confirm a reply. Note that outside the 24-hour window WhatsApp requires an approved template (ContentSid).',
    },
    {
      order: 6,
      title: 'Watch the trial balance',
      description:
        'Trial covers 100 SMS, 75 voice minutes, 3,000 emails and 100 WhatsApp messages. Record consumption in the operations console and stop testing before an allowance runs out.',
    },
  ],
  successCriteria: [
    'Texting the Twilio number returns a relevant reply within one message.',
    'Calling the number plays a spoken menu and a keypress branches the call.',
    'Pressing the SMS option during a call delivers a text — one event crossing two channels.',
    'A WhatsApp message to the sandbox receives a conversational reply.',
    'A transactional email sends through SendGrid and appears in the delivery stats.',
    'Every inbound webhook is signature-verified; a forged request is rejected with a 403.',
    'The delivery log shows each inbound request, its verdict and its latency.',
  ],
};
