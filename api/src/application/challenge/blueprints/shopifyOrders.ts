/**
 * Blueprint: Shopify order notifications.
 *
 * The brief this answers is "customers ask where their order is". The fix is not
 * a support system, it is telling them before they ask: a confirmation the moment
 * the order is placed, a tracking link the moment it ships, and a real answer when
 * they text back.
 *
 * ── THE FACT A MODEL GETS WRONG ─────────────────────────────────────────────
 * Shopify signs webhooks with `X-Shopify-Hmac-Sha256`, and the value is
 * **base64**, not hex. Everything else about it looks like the generic
 * "HMAC-SHA256 the raw body" scheme, so the natural guess produces a comparison
 * that can never match and a failure indistinguishable from a wrong secret. That
 * is pinned here as `verify: "shopify"`.
 *
 * A second fact worth pinning: Shopify's webhook body is JSON, so the raw bytes
 * must be signed as received. Re-serialising the parsed object changes key order
 * and whitespace and breaks the MAC — the ingress keeps the raw text.
 *
 * ── WHY THERE IS NO SHOPIFY CONNECTOR STEP ──────────────────────────────────
 * Everything this needs is already IN the webhook payload — line items, totals,
 * the customer's phone and email, the fulfilment's tracking URL. Calling the Admin
 * API back to fetch what was just delivered would be a round-trip for nothing and
 * a second credential to hold. The outbound half is Twilio and SendGrid.
 */

import type { Blueprint } from '../blueprint';
import { renderOpsConsole } from './opsConsole';

const ORDER_PERSONA =
  'You write order notifications for {{project.name}}. Be concrete and short. Never invent a ' +
  'delivery date, a carrier or a tracking number that was not given to you. No marketing language.';

const handlers: Record<string, unknown> = {
  /**
   * `orders/create` — the confirmation.
   *
   * SMS first because it is read; email carries the detail. Both are guarded by a
   * `when` on the contact field actually present: a Shopify order can have an
   * email and no phone, or the reverse, and sending to an empty address is a
   * provider error rather than a no-op.
   */
  'order-created': {
    name: 'order-created',
    route: '/shopify/order-created',
    method: 'POST',
    verify: 'shopify',
    description: 'orders/create → SMS and email confirmation with the real order contents.',
    steps: [
      {
        id: 'summary',
        kind: 'llm',
        system: ORDER_PERSONA,
        prompt:
          'Write a one-sentence order confirmation for SMS, under 140 characters. ' +
          'Order {{body.name}} for {{body.total_price}} {{body.currency}}. ' +
          'Items: {{body.line_items}}. Name the number of items and the total, nothing else.',
        maxTokens: 80,
        temperature: 0.2,
      },
      {
        id: 'sms',
        kind: 'connector',
        when: '{{body.customer.phone}}',
        connector: 'twilio',
        action: 'send_sms',
        input: {
          To: '{{body.customer.phone}}',
          Body: '{{steps.summary}} Reply to this message with any question about it.',
        },
      },
      {
        id: 'email',
        kind: 'connector',
        when: '{{body.email}}',
        connector: 'sendgrid',
        action: 'send_html_email',
        input: {
          to: '{{body.email}}',
          from: 'orders@example.com',
          fromName: '{{project.name}}',
          subject: 'Order {{body.name}} confirmed',
          text: '{{steps.summary}}',
          html: '<p>{{steps.summary}}</p><p><a href="{{body.order_status_url}}">Track this order</a></p>',
        },
      },
    ],
    // Shopify reads the status code. A non-2xx is retried, and 19 consecutive
    // failures over 48 hours delete the subscription — so a broken handler that
    // 500s does not just retry, it eventually unsubscribes itself.
    respond: { kind: 'empty', status: 200 },
  },

  /** `orders/fulfilled` — the message customers actually want: it shipped, here
   *  is where it is. The tracking URL comes from the fulfilment in the payload. */
  'order-fulfilled': {
    name: 'order-fulfilled',
    route: '/shopify/order-fulfilled',
    method: 'POST',
    verify: 'shopify',
    description: 'orders/fulfilled → shipping notification with the carrier tracking link.',
    steps: [
      {
        id: 'sms',
        kind: 'connector',
        when: '{{body.customer.phone}}',
        connector: 'twilio',
        action: 'send_sms',
        input: {
          To: '{{body.customer.phone}}',
          Body: 'Order {{body.name}} has shipped. Track it: {{body.fulfillments[0].tracking_url}}',
        },
      },
      {
        id: 'email',
        kind: 'connector',
        when: '{{body.email}}',
        connector: 'sendgrid',
        action: 'send_html_email',
        input: {
          to: '{{body.email}}',
          from: 'orders@example.com',
          fromName: '{{project.name}}',
          subject: 'Order {{body.name}} has shipped',
          text: 'Your order is on its way. Tracking: {{body.fulfillments[0].tracking_url}}',
          html: '<p>Your order is on its way.</p><p><a href="{{body.fulfillments[0].tracking_url}}">Track your delivery</a> ({{body.fulfillments[0].tracking_company}})</p>',
        },
      },
    ],
    respond: { kind: 'empty', status: 200 },
  },

  /**
   * The reply path. Confirmations that cannot be replied to are how "where is my
   * order?" ends up in a support inbox — so the number the SMS came from answers.
   * Twilio signs this one, not Shopify: it is an inbound Twilio webhook.
   */
  'order-question': {
    name: 'order-question',
    route: '/shopify/order-question',
    method: 'POST',
    verify: 'twilio',
    description: 'Customer replies by SMS → answer in the same turn.',
    steps: [
      {
        id: 'reply',
        kind: 'llm',
        system:
          ORDER_PERSONA +
          ' You do not have access to the order database in this reply. If the question needs a ' +
          'specific order status, say a human will follow up shortly and do not guess.',
        prompt: 'Customer {{body.From}} replied: "{{body.Body}}"\n\nWrite the reply text only.',
        maxTokens: 160,
        temperature: 0.3,
      },
    ],
    // Replying inside the TwiML keeps the exchange to one billed message.
    respond: { kind: 'twiml', twiml: [{ message: '{{steps.reply}}' }] },
  },
};

const CONSOLE_HTML = renderOpsConsole({
  title: 'Order notifications console',
  subtitle: 'Confirmation, shipping and the reply path — driven by Shopify’s own order events.',
  targetLabel: 'Add to Shopify → Settings → Notifications → Webhooks',
  routes: [
    { label: 'orders/create', path: '/shopify/order-created' },
    { label: 'orders/fulfilled', path: '/shopify/order-fulfilled' },
    { label: 'Customer SMS reply (Twilio)', path: '/shopify/order-question' },
  ],
});

const RUNBOOK = `# Shopify order notifications — runbook

Tells customers where their order is before they ask, and answers when they reply.

## What is already running

| Source | Endpoint | What it does |
| --- | --- | --- |
| Shopify \`orders/create\` | \`POST /shopify/order-created\` | SMS + email confirmation with the real contents and total. |
| Shopify \`orders/fulfilled\` | \`POST /shopify/order-fulfilled\` | Shipping notice with the carrier tracking link. |
| Twilio inbound SMS | \`POST /shopify/order-question\` | Answers a customer's reply in the same message. |

## Setup, in order

1. **Create the Shopify webhooks.** Settings → Notifications → Webhooks. Add
   \`Order creation\` → the order-created URL and \`Order fulfilled\` → the
   order-fulfilled URL, both with format **JSON**.
2. **Store \`SHOPIFY_WEBHOOK_SECRET\`.** Shopify shows the signing secret once,
   below the webhook list ("Your webhooks will be signed with…"). Store it as the
   project secret. Until then every delivery is rejected with a 403 — fail-closed,
   not an outage.
3. **Connect Twilio** and store \`TWILIO_AUTH_TOKEN\` as a project secret. The
   reply handler verifies inbound Twilio signatures against it.
4. **Point your Twilio number's inbound SMS webhook** at the order-question URL,
   either in the Twilio Console or with the Twilio connector's
   \`configure_number\` action.
5. **Connect SendGrid**, verify a sender, and replace \`orders@example.com\` in
   both handlers with it.

## Two things that bite

- **The signature is base64.** If you reimplement this elsewhere, do not hex it.
  A hex comparison never matches and looks exactly like a wrong secret.
- **Repeated failures unsubscribe you.** Shopify retries a non-2xx, and after 19
  consecutive failures over 48 hours it DELETES the webhook subscription. A
  handler that errors is not merely noisy; it eventually goes silent. The runtime
  returns a well-formed 200 even when a step fails, specifically to avoid that.

## Proving it works

- Place a test order with a real phone number and email, and confirm both arrive
  with the correct total and item count.
- Fulfil it with tracking and confirm the tracking link in both messages resolves.
- Reply to the SMS and confirm an answer comes back.
- Send a request with a wrong signature and confirm a 403 in the delivery log.

## Extending it

Add \`orders/cancelled\` and \`refunds/create\` the same way — one endpoint per
event, \`verify: "shopify"\`, and the payload already carries what you need.
`;

export const shopifyOrdersBlueprint: Blueprint = {
  key: 'shopify-orders',
  name: 'Shopify order notifications',
  summary:
    'Order confirmation and shipping notices by SMS and email, driven by Shopify’s own order events, with a reply path so the customer can just answer the text.',
  // "order", "store" and "tracking" are ordinary words — the Twilio brief uses
  // all three about something else ("order notifications", "call tracking").
  signals: ['shopify', 'fulfillment', 'fulfilment', 'order status', 'shipping notification', 'abandoned cart', 'ecommerce', 'e-commerce', 'storefront'],
  capabilities: ['ecommerce', 'sms', 'email', 'inbound-webhook', 'notifications', 'ai-agent', 'dashboard'],
  requiredConnectors: [
    { key: 'twilio', label: 'Twilio', why: 'Sends the SMS notifications and receives the customer’s reply.' },
    { key: 'sendgrid', label: 'SendGrid', why: 'Sends the confirmation and shipping email.' },
  ],
  requiredSecrets: [
    {
      name: 'SHOPIFY_WEBHOOK_SECRET',
      label: 'Shopify webhook signing secret',
      where:
        'Shopify admin → Settings → Notifications → Webhooks, shown once beneath the webhook list. Shopify signs with base64, not hex.',
    },
    {
      name: 'TWILIO_AUTH_TOKEN',
      label: 'Twilio auth token',
      where: 'Twilio Console → Account Info. The reply handler verifies inbound Twilio signatures against it.',
    },
  ],
  strategy: 'declarative',
  files: { 'index.html': CONSOLE_HTML, 'RUNBOOK.md': RUNBOOK },
  handlers,
  tasks: [
    {
      order: 1,
      title: 'Create the Shopify webhooks and store the signing secret',
      description:
        'Add Order creation and Order fulfilled webhooks in JSON format pointing at the two URLs, then store the signing secret shown beneath the webhook list as SHOPIFY_WEBHOOK_SECRET. Deliveries are rejected with a 403 until it is set.',
    },
    {
      order: 2,
      title: 'Connect Twilio and store TWILIO_AUTH_TOKEN',
      description:
        'Add the Twilio connection (Account SID + auth token) and store the same auth token as the project secret TWILIO_AUTH_TOKEN, which the reply handler verifies against.',
    },
    {
      order: 3,
      title: 'Point the Twilio number at the reply handler',
      description:
        'Set the number’s inbound SMS webhook to <ingress>/shopify/order-question, in the Twilio Console or with the configure_number action. A confirmation that cannot be replied to sends the question to your support inbox instead.',
    },
    {
      order: 4,
      title: 'Connect SendGrid and set the sender address',
      description:
        'Verify a sender in SendGrid and replace orders@example.com in both handlers with it. SendGrid rejects sends from unverified addresses.',
    },
    {
      order: 5,
      title: 'Place a test order end to end',
      description:
        'Place a real test order with a working phone and email, confirm both messages, then fulfil it with tracking and confirm the shipping notice and that the tracking link resolves.',
    },
    {
      order: 6,
      title: 'Watch the delivery log for retries',
      description:
        'Shopify deletes a webhook subscription after 19 consecutive failures over 48 hours. Check the Backend panel’s delivery log for non-ok verdicts before they accumulate.',
    },
  ],
  successCriteria: [
    'Placing an order sends an SMS and an email with the correct item count and total.',
    'Fulfilling the order sends a shipping notice whose tracking link resolves to the carrier.',
    'Replying to the SMS gets a relevant answer within one message.',
    'Every Shopify delivery is HMAC-verified against the base64 signature; a forged request is rejected with a 403.',
    'An order with only an email, or only a phone, still notifies on the channel it has.',
    'The delivery log shows 2xx for every Shopify delivery, so the subscription is never auto-removed.',
  ],
};
