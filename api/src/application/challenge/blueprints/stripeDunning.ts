/**
 * Blueprint: Stripe billing operations and dunning.
 *
 * The brief this answers is "we lose revenue to failed payments — build the
 * recovery flow". Involuntary churn is the largest category of SaaS churn and the
 * only one a system can fix without a salesperson, which is why this is the
 * highest-value non-communications blueprint.
 *
 * ── THE FACT A MODEL GETS WRONG ─────────────────────────────────────────────
 * Stripe does NOT sign the request body. `Stripe-Signature` is
 * `t=<unix>,v1=<hex>` and the signed payload is `"<t>.<rawBody>"`, with the
 * timestamp inside the MAC so a captured event cannot be replayed forever. A
 * generated integration that HMACs the body — the obvious guess, and what the
 * generic `shared-secret` kind does — rejects 100% of real Stripe traffic and
 * looks exactly like a wrong secret. That is pinned here as `verify: "stripe"`.
 *
 * ── WHY ONE HANDLER PER EVENT RATHER THAN A SWITCH ──────────────────────────
 * The handler vocabulary has `when` (run this step or don't) but no equality
 * test, so branching on `body.type` inside one handler is not expressible. It
 * does not need to be: Stripe endpoints are configured with an event selection,
 * so three endpoints each subscribed to one event is the idiomatic shape anyway —
 * and it means a failure in the churn path cannot take down the recovery path.
 */

import type { Blueprint } from '../blueprint';
import { renderOpsConsole } from './opsConsole';

/** Shared voice for the generated customer-facing copy. Dunning mail that reads
 *  like a threat is how a recoverable payment becomes a cancellation. */
const DUNNING_PERSONA =
  'You write billing email for {{project.name}}. Be brief, warm and specific. Never threaten, ' +
  'never guess an amount, a date or a card number that is not given to you, and always make the ' +
  'next action a single obvious step. Plain text only, under 120 words.';

const handlers: Record<string, unknown> = {
  /**
   * `invoice.payment_failed` — the moment recovery starts.
   *
   * Stripe retries the charge on its own schedule; the job here is the human
   * half. The email goes out immediately because the recoverable window is the
   * first 24 hours, and the internal alert goes to Slack so a large account is
   * not left to an automated sequence alone.
   */
  'payment-failed': {
    name: 'payment-failed',
    route: '/stripe/payment-failed',
    method: 'POST',
    verify: 'stripe',
    description: 'invoice.payment_failed → dunning email to the customer, alert to the team.',
    steps: [
      {
        id: 'email',
        kind: 'llm',
        system: DUNNING_PERSONA,
        prompt:
          'A payment failed. Customer email: {{body.data.object.customer_email}}. ' +
          'Amount due: {{body.data.object.amount_due}} {{body.data.object.currency}}. ' +
          'Attempt {{body.data.object.attempt_count}}. ' +
          'Write the body of an email asking them to update their payment method. ' +
          'Do not include a subject line or a signature.',
        maxTokens: 220,
        temperature: 0.3,
      },
      {
        id: 'notify',
        kind: 'connector',
        // The hosted invoice URL is Stripe's own update-payment page. Sending a
        // link we minted instead would be a phishing-shaped email from our own
        // system, and customers are correctly trained to distrust those.
        when: '{{body.data.object.customer_email}}',
        connector: 'sendgrid',
        action: 'send_html_email',
        input: {
          to: '{{body.data.object.customer_email}}',
          from: 'billing@example.com',
          fromName: '{{project.name}} billing',
          subject: 'We could not process your payment',
          text: '{{steps.email}}',
          html: '<p>{{steps.email}}</p><p><a href="{{body.data.object.hosted_invoice_url}}">Update your payment method</a></p>',
        },
      },
      {
        id: 'alert',
        kind: 'connector',
        connector: 'slack',
        action: 'post_message',
        input: {
          channel: '#billing',
          text:
            ':credit_card: Payment failed — {{body.data.object.customer_email}} · ' +
            '{{body.data.object.amount_due}} {{body.data.object.currency}} · ' +
            'attempt {{body.data.object.attempt_count}} · <{{body.data.object.hosted_invoice_url}}|invoice>',
        },
      },
    ],
    // Stripe reads the STATUS CODE, not the body: a 2xx means delivered, anything
    // else means retry. An empty 200 is the whole contract.
    respond: { kind: 'empty', status: 200 },
  },

  /** `invoice.payment_succeeded` — close the loop so a recovered customer is not
   *  chased by the next email in the sequence. */
  'payment-recovered': {
    name: 'payment-recovered',
    route: '/stripe/payment-recovered',
    method: 'POST',
    verify: 'stripe',
    description: 'invoice.payment_succeeded → confirm to the customer, close the alert.',
    steps: [
      {
        id: 'receipt',
        kind: 'connector',
        when: '{{body.data.object.customer_email}}',
        connector: 'sendgrid',
        action: 'send_html_email',
        input: {
          to: '{{body.data.object.customer_email}}',
          from: 'billing@example.com',
          fromName: '{{project.name}} billing',
          subject: 'Payment received — thank you',
          text: 'We received your payment of {{body.data.object.amount_paid}} {{body.data.object.currency}}. Your account is up to date.',
          html: '<p>We received your payment of {{body.data.object.amount_paid}} {{body.data.object.currency}}. Your account is up to date.</p><p><a href="{{body.data.object.hosted_invoice_url}}">View the receipt</a></p>',
        },
      },
      {
        id: 'alert',
        kind: 'connector',
        connector: 'slack',
        action: 'post_message',
        input: {
          channel: '#billing',
          text: ':white_check_mark: Recovered — {{body.data.object.customer_email}} paid {{body.data.object.amount_paid}} {{body.data.object.currency}}',
        },
      },
    ],
    respond: { kind: 'empty', status: 200 },
  },

  /** `customer.subscription.deleted` — churn. The only automated action worth
   *  taking is telling a human quickly enough to do something about it. */
  'subscription-canceled': {
    name: 'subscription-canceled',
    route: '/stripe/subscription-canceled',
    method: 'POST',
    verify: 'stripe',
    description: 'customer.subscription.deleted → churn alert with a drafted win-back.',
    steps: [
      {
        id: 'winback',
        kind: 'llm',
        system: DUNNING_PERSONA,
        prompt:
          'A subscription was cancelled. Status before cancellation: {{body.data.object.status}}. ' +
          'Cancellation reason if given: {{body.data.object.cancellation_details.reason}}. ' +
          'Draft two sentences a human could send to ask what went wrong. Do not offer a discount.',
        maxTokens: 120,
        temperature: 0.4,
      },
      {
        id: 'alert',
        kind: 'connector',
        connector: 'slack',
        action: 'post_message',
        input: {
          channel: '#billing',
          text:
            ':wave: Subscription cancelled — customer {{body.data.object.customer}} · ' +
            'reason: {{body.data.object.cancellation_details.reason}}\n>{{steps.winback}}',
        },
      },
    ],
    respond: { kind: 'empty', status: 200 },
  },
};

const CONSOLE_HTML = renderOpsConsole({
  title: 'Billing operations console',
  subtitle: 'Failed payments, recoveries and churn — one endpoint per Stripe event.',
  targetLabel: 'Add to Stripe → Developers → Webhooks',
  routes: [
    { label: 'invoice.payment_failed', path: '/stripe/payment-failed' },
    { label: 'invoice.payment_succeeded', path: '/stripe/payment-recovered' },
    { label: 'customer.subscription.deleted', path: '/stripe/subscription-canceled' },
  ],
});

const RUNBOOK = `# Stripe dunning — runbook

Recovers revenue lost to failed payments, and tells a human when an account
churns. Three endpoints, one per Stripe event.

## What is already running

| Stripe event | Endpoint | What it does |
| --- | --- | --- |
| \`invoice.payment_failed\` | \`POST /stripe/payment-failed\` | Drafts and sends a dunning email, alerts #billing. |
| \`invoice.payment_succeeded\` | \`POST /stripe/payment-recovered\` | Confirms to the customer, closes the alert. |
| \`customer.subscription.deleted\` | \`POST /stripe/subscription-canceled\` | Churn alert with a drafted win-back message. |

## Setup, in order

1. **Connect Stripe** (Integrations → Connectors → Stripe) with a restricted
   secret key. The handlers only read invoices and subscriptions; do not give this
   key write access it does not need.
2. **Create the webhook endpoints.** Stripe Dashboard → Developers → Webhooks →
   Add endpoint. Create **three** endpoints, one per URL above, and subscribe each
   to only its own event. One endpoint subscribed to everything would deliver every
   event to every handler.
3. **Store \`STRIPE_WEBHOOK_SECRET\`** as a project secret. Stripe shows a
   *different* signing secret (\`whsec_…\`) per endpoint — if you create three
   endpoints you get three secrets. Either reuse one endpoint's secret for all
   three by creating them from the same signing secret, or run one endpoint at a
   time. Until this is stored, every delivery is rejected with a 403; that is
   fail-closed, not an outage.
4. **Connect SendGrid** and verify a sender, then replace
   \`billing@example.com\` in the handlers with it — SendGrid rejects a send from
   an unverified address.
5. **Connect Slack** and confirm the bot is in \`#billing\`.

## Why the signature check matters here

An unverified billing webhook is worse than an unverified messaging one: anyone
who learns the URL can forge \`invoice.payment_failed\` for any email address and
make the system send billing mail to arbitrary people from your verified domain.
That is a deliverability incident and a phishing vector at once.

## Proving it works

- Stripe Dashboard → the endpoint → **Send test webhook** → \`invoice.payment_failed\`.
  Confirm a 200 in Stripe's delivery log and an entry in the Backend panel's log.
- Use a test card that fails (\`4000 0000 0000 0341\`) on a real subscription and
  confirm the email arrives.
- Change one character of \`STRIPE_WEBHOOK_SECRET\` and confirm deliveries start
  failing with a 403 — the check is real.

## Tuning

- The retry schedule is Stripe's (Settings → Billing → Subscriptions and emails).
  This system handles the human half; do not build a second retry loop.
- The email copy is generated per event so it can name the amount and the attempt
  number. If you need a fixed template instead, swap the \`llm\` step for a
  \`send_template_email\` action against a SendGrid dynamic template.
`;

export const stripeDunningBlueprint: Blueprint = {
  key: 'stripe-dunning',
  name: 'Stripe billing operations and dunning',
  summary:
    'Recovers failed payments and surfaces churn: a dunning email drafted per event, a recovery confirmation, and a churn alert with a drafted win-back — all behind a real Stripe signature check.',
  // Signals must NAME this system, not merely describe money. "invoice" and
  // "payment" are ordinary English and appear in briefs that have nothing to do
  // with Stripe recovery — a reconciliation tool, an expenses app — so they are
  // deliberately absent.
  signals: ['stripe', 'dunning', 'failed payment', 'payment failed', 'past due', 'past_due', 'involuntary churn', 'subscription'],
  capabilities: ['payments', 'email', 'inbound-webhook', 'notifications', 'ai-agent', 'dashboard'],
  requiredConnectors: [
    { key: 'stripe', label: 'Stripe', why: 'Reads invoices, charges and subscriptions behind the events.' },
    { key: 'sendgrid', label: 'SendGrid', why: 'Sends the dunning and recovery email.' },
    { key: 'slack', label: 'Slack', why: 'Where the team sees a failed payment or a cancellation in time to act.' },
  ],
  requiredSecrets: [
    {
      name: 'STRIPE_WEBHOOK_SECRET',
      label: 'Stripe webhook signing secret',
      where:
        'Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret (whsec_…). Note this is per-endpoint and is NOT your API key.',
    },
  ],
  strategy: 'declarative',
  files: { 'index.html': CONSOLE_HTML, 'RUNBOOK.md': RUNBOOK },
  handlers,
  tasks: [
    {
      order: 1,
      title: 'Connect Stripe and create the three webhook endpoints',
      description:
        'Add the Stripe connection with a restricted secret key, then create one webhook endpoint per URL in the console, each subscribed to only its own event. A single endpoint subscribed to all events would deliver every event to every handler.',
    },
    {
      order: 2,
      title: 'Store STRIPE_WEBHOOK_SECRET',
      description:
        'Copy the signing secret (whsec_…) from the endpoint and store it as the project secret STRIPE_WEBHOOK_SECRET. It is not the API key, and it is per-endpoint. Deliveries are rejected with a 403 until it is set.',
    },
    {
      order: 3,
      title: 'Connect SendGrid and set the sender address',
      description:
        'Verify a sender in SendGrid, then replace billing@example.com in the payment-failed and payment-recovered handlers with it. SendGrid rejects sends from unverified addresses.',
    },
    {
      order: 4,
      title: 'Connect Slack and confirm the #billing channel',
      description: 'Add the Slack connection and invite the bot to #billing, or change the channel in the handlers.',
    },
    {
      order: 5,
      title: 'Fire a test event and confirm the delivery log',
      description:
        'Send a test invoice.payment_failed from the Stripe dashboard. Confirm a 200 in Stripe’s delivery log, an ok verdict in the Backend panel, and the email arriving.',
    },
    {
      order: 6,
      title: 'Prove the signature check is real',
      description:
        'Temporarily corrupt STRIPE_WEBHOOK_SECRET and confirm deliveries start failing with a 403 in the delivery log, then restore it. An unverified billing webhook lets anyone send mail from your verified domain.',
    },
  ],
  successCriteria: [
    'A failed payment produces a dunning email to the real customer address within seconds.',
    'A recovered payment produces a confirmation and closes the loop in Slack.',
    'A cancellation posts a churn alert with a drafted win-back message.',
    'Every delivery is Stripe-signature verified, including the timestamp tolerance — a replayed event is rejected.',
    'A forged request with a wrong signature is rejected with a 403 and appears in the delivery log.',
    'Stripe’s own delivery log shows 2xx for every endpoint.',
  ],
};
