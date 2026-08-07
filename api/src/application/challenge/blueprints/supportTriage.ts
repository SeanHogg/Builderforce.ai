/**
 * Blueprint: support intake, triage and routing.
 *
 * The brief this answers is "requests arrive from a form / an inbox / a partner
 * system and someone reads them all". The work worth automating is not the reply
 * — it is the TRIAGE: severity, category, and who should see it now rather than
 * on Monday. That decision is a judgement call over free text, which is exactly
 * what a model is good at and exactly what a keyword rule is bad at.
 *
 * ── WHAT MAKES THIS SAFE TO AUTOMATE ────────────────────────────────────────
 * The system never answers the customer on its own. It opens a ticket, posts to
 * the channel, and drafts a suggested reply for a human to send. An automated
 * support reply that is confidently wrong costs more than the triage saves, and
 * a blueprint that shipped one would be teaching the wrong pattern.
 *
 * ── THE INBOUND SHAPE ───────────────────────────────────────────────────────
 * Intake is a signed JSON POST (`verify: "shared-secret"`) rather than a
 * vendor-specific webhook, because the source differs per customer — a website
 * form, an email parser, a partner system. That is the one place where "generic"
 * is the right answer: the payload is the customer's own, and pinning it to one
 * vendor's schema would make the blueprint fit fewer briefs, not more.
 */

import type { Blueprint } from '../blueprint';
import { renderOpsConsole } from './opsConsole';

const TRIAGE_PERSONA =
  'You triage inbound support requests for {{project.name}}. You are terse and you never invent ' +
  'facts about the customer, their plan, or their data. If the message is ambiguous, say so rather ' +
  'than guessing.';

const handlers: Record<string, unknown> = {
  /**
   * Intake. Three steps, in an order that matters: classify FIRST so the ticket
   * carries the priority and the Slack post carries both — a ticket opened before
   * classification would need a second write to update it.
   */
  intake: {
    name: 'intake',
    route: '/support/intake',
    method: 'POST',
    verify: 'shared-secret',
    description: 'Signed inbound request → classify, open a Zendesk ticket, alert the channel with a drafted reply.',
    steps: [
      {
        id: 'priority',
        kind: 'llm',
        system: TRIAGE_PERSONA,
        prompt:
          'Classify the severity of this request. Answer with EXACTLY one lowercase word from: ' +
          'urgent, high, normal, low. No punctuation, no explanation.\n\n' +
          'Subject: {{body.subject}}\nFrom: {{body.email}}\n\n{{body.message}}',
        maxTokens: 5,
        temperature: 0,
      },
      {
        id: 'summary',
        kind: 'llm',
        system: TRIAGE_PERSONA,
        prompt:
          'Summarise this request in one sentence, then on a new line give the single most likely ' +
          'category.\n\nSubject: {{body.subject}}\n\n{{body.message}}',
        maxTokens: 100,
        temperature: 0.2,
      },
      {
        id: 'draft',
        kind: 'llm',
        system:
          TRIAGE_PERSONA +
          ' Write a reply a human agent could send after a quick check. Plain text, under 120 words, ' +
          'no promises about timelines you were not given.',
        prompt: 'Draft a reply to:\n\nSubject: {{body.subject}}\nFrom: {{body.email}}\n\n{{body.message}}',
        maxTokens: 220,
        temperature: 0.3,
      },
      {
        id: 'ticket',
        kind: 'connector',
        connector: 'zendesk',
        action: 'create_ticket',
        input: {
          subject: '{{body.subject}}',
          comment: '{{body.message}}',
          // The model is constrained to Zendesk's own four values; anything else
          // is rejected by the API rather than silently stored.
          priority: '{{steps.priority}}',
          requester_email: '{{body.email}}',
        },
      },
      {
        id: 'alert',
        kind: 'connector',
        connector: 'slack',
        action: 'post_message',
        input: {
          channel: '#support',
          text:
            ':inbox_tray: *{{steps.priority}}* — {{body.subject}}\n' +
            '{{steps.summary}}\n' +
            'From {{body.email}} · ticket {{steps.ticket.ticket.id}}\n' +
            '_Suggested reply (not sent):_\n>{{steps.draft}}',
        },
      },
    ],
    // Echo the classification back to whatever posted the form, so the sender can
    // show the customer a reference number instead of a bare 200.
    respond: {
      kind: 'json',
      body: {
        received: true,
        priority: '{{steps.priority}}',
        ticket: '{{steps.ticket.ticket.id}}',
      },
    },
  },

  /**
   * Escalation sweep. Called on a schedule by anything that can make a signed
   * POST — a cron, a monitor, a person with curl — and reports what is still open
   * and urgent. A queue nobody looks at is the failure mode this prevents.
   */
  escalate: {
    name: 'escalate',
    route: '/support/escalate',
    method: 'POST',
    verify: 'shared-secret',
    description: 'Signed sweep → find open urgent tickets and post them to the channel.',
    steps: [
      {
        id: 'open',
        kind: 'connector',
        connector: 'zendesk',
        action: 'search_tickets',
        input: { query: 'type:ticket status:open priority:urgent', sort_by: 'created_at' },
      },
      {
        id: 'digest',
        kind: 'llm',
        system: TRIAGE_PERSONA,
        prompt:
          'These are the open urgent tickets. Write a short bullet list naming each one and what it ' +
          'is about. If the list is empty, reply exactly "No open urgent tickets."\n\n{{steps.open}}',
        maxTokens: 300,
        temperature: 0.2,
      },
      {
        id: 'alert',
        kind: 'connector',
        connector: 'slack',
        action: 'post_message',
        input: { channel: '#support', text: ':rotating_light: *Open urgent tickets*\n{{steps.digest}}' },
      },
    ],
    respond: { kind: 'json', body: { ok: true, digest: '{{steps.digest}}' } },
  },
};

const CONSOLE_HTML = renderOpsConsole({
  title: 'Support triage console',
  subtitle: 'Intake, classify, route — every request lands in one place with a severity already on it.',
  targetLabel: 'Post your form / inbox parser to',
  routes: [
    { label: 'Request intake', path: '/support/intake' },
    { label: 'Urgent sweep', path: '/support/escalate' },
  ],
});

const RUNBOOK = `# Support triage — runbook

Turns free-text requests into classified, routed, ticketed work — without
answering the customer on the system's own authority.

## What is already running

| Endpoint | What it does |
| --- | --- |
| \`POST /support/intake\` | Classifies severity, summarises, opens a Zendesk ticket, posts to Slack with a **drafted** reply. |
| \`POST /support/escalate\` | Sweeps open urgent tickets and posts a digest. Call it on a schedule. |

## The intake payload

Post JSON with these fields:

\`\`\`json
{ "subject": "Cannot log in", "email": "ada@example.com", "message": "Since the update…" }
\`\`\`

Sign it: \`X-Builderforce-Signature: sha256=<hex HMAC-SHA256 of the raw body,
keyed with WEBHOOK_SHARED_SECRET>\`. The \`sha256=\` prefix is optional. This is
the same shape GitHub uses, so \`X-Hub-Signature-256\` is accepted too.

## Setup, in order

1. **Store \`WEBHOOK_SHARED_SECRET\`** as a project secret — any long random
   string. Give the same value to whatever posts the form. Until it is set, every
   request is rejected with a 403.
2. **Connect Zendesk** (subdomain, \`you@acme.com/token\`, API token).
3. **Connect Slack** and invite the bot to \`#support\`.
4. **Point your form at the intake URL.** Most form builders and email parsers can
   send a signed JSON POST; if yours cannot sign, put a small function in front of
   it rather than setting \`verify\` to \`none\` — an open intake endpoint lets
   anyone create tickets in your Zendesk.
5. **Schedule the sweep.** Anything that can make a signed POST works.

## Why nothing is auto-replied

The drafted reply is posted to Slack, not sent. Support automation earns trust by
being right; one confidently wrong automated answer costs more than the triage
saves. When you are ready to send some categories automatically, add a Zendesk
\`add_comment\` step guarded by a \`when\` on the classification.

## Proving it works

- Post a signed test request and confirm: a ticket appears in Zendesk with the
  right priority, a Slack message appears with the summary and draft, and the JSON
  response carries the ticket id.
- Post the same request with a wrong signature and confirm a 403 in the delivery log.
- Run the sweep with no urgent tickets open and confirm it says so rather than
  posting an empty list.
`;

export const supportTriageBlueprint: Blueprint = {
  key: 'support-triage',
  name: 'Support intake, triage and routing',
  summary:
    'Signed request intake that classifies severity, summarises, opens a Zendesk ticket and posts to Slack with a drafted reply — plus a scheduled sweep for anything urgent still open.',
  // "support" and "ticket" alone are too ordinary — the Twilio brief says
  // "two-way support" about SMS, which is a different system entirely.
  signals: ['zendesk', 'helpdesk', 'help desk', 'triage', 'intercom', 'freshdesk', 'support ticket', 'support queue', 'service desk'],
  capabilities: ['inbound-webhook', 'chat', 'notifications', 'ai-agent', 'crm', 'dashboard', 'analytics'],
  requiredConnectors: [
    { key: 'zendesk', label: 'Zendesk', why: 'Where the triaged request becomes a ticket an agent owns.' },
    { key: 'slack', label: 'Slack', why: 'Where the team sees the request, its severity and the drafted reply.' },
  ],
  requiredSecrets: [
    {
      name: 'WEBHOOK_SHARED_SECRET',
      label: 'Intake signing secret',
      where:
        'Any long random string you choose. Give the same value to whatever posts the form, and store it here — the intake endpoint rejects anything it cannot verify.',
    },
  ],
  strategy: 'declarative',
  files: { 'index.html': CONSOLE_HTML, 'RUNBOOK.md': RUNBOOK },
  handlers,
  tasks: [
    {
      order: 1,
      title: 'Store WEBHOOK_SHARED_SECRET and sign the intake',
      description:
        'Choose a long random string, store it as the project secret WEBHOOK_SHARED_SECRET, and configure the sender to add X-Builderforce-Signature: sha256=<hex HMAC-SHA256 of the raw body>. An unsigned intake endpoint lets anyone create tickets in your Zendesk.',
    },
    {
      order: 2,
      title: 'Connect Zendesk',
      description: 'Add the Zendesk connection: subdomain, the you@acme.com/token username form, and an API token.',
    },
    {
      order: 3,
      title: 'Connect Slack and confirm #support',
      description: 'Add the Slack connection and invite the bot to #support, or change the channel in the handlers.',
    },
    {
      order: 4,
      title: 'Point the form or inbox parser at /support/intake',
      description:
        'Send { subject, email, message } as signed JSON. If the source cannot sign, put a small function in front of it rather than setting verify to none.',
    },
    {
      order: 5,
      title: 'Schedule the urgent sweep',
      description:
        'Call POST /support/escalate on a schedule with the same signature. A queue nobody looks at is the failure this prevents.',
    },
    {
      order: 6,
      title: 'Decide what may be auto-answered',
      description:
        'Nothing is auto-replied by default — the draft goes to Slack for a human. When a category is safe to answer automatically, add a Zendesk add_comment step guarded by a when on the classification.',
    },
  ],
  successCriteria: [
    'A signed test request produces a Zendesk ticket with a sensible priority within seconds.',
    'The Slack post carries the severity, a one-line summary and a drafted reply.',
    'The intake response returns the ticket id so the sender can show a reference.',
    'An unsigned or wrongly-signed request is rejected with a 403 and appears in the delivery log.',
    'The urgent sweep reports accurately, including when nothing is open.',
    'No customer receives an automated reply that a human did not send.',
  ],
};
