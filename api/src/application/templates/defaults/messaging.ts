/**
 * Messaging templates — a customer line that answers, and a verification flow
 * that keeps the wrong people out of it.
 *
 * The facts pinned here are the ones a general-purpose designer gets wrong and
 * the ones a customer cannot debug: that an inbound Twilio webhook is verified
 * with Twilio's own URL-plus-sorted-parameters scheme rather than a generic
 * HMAC header, and that the reply goes back to `{{input.From}}` — Twilio's field
 * name, capitalised the way Twilio capitalises it.
 */

import { ask, call, chain, checklist, llm, needs, projectStep, type BuiltinTemplate } from './dsl';

const customerLine: BuiltinTemplate = {
  key: 'omnichannel-customer-line',
  name: 'Answer customers on SMS and WhatsApp',
  summary: 'One number, answered automatically — with the conversation history kept in one place whichever channel it arrives on.',
  description:
    'Inbound messages hit a webhook, get answered from the context you supply, and are replied to on the channel they came in on. Anything the answer is not confident about is left for a person, on the board, rather than guessed at.',
  category: 'messaging',
  icon: '💬',
  tags: ['twilio', 'sms', 'whatsapp', 'support', 'inbox'],
  requiredConnectors: [
    needs('twilio', 'Twilio', 'Replies are sent from your Twilio number, on whichever channel the message arrived on.'),
  ],
  requiredSecrets: [],
  steps: [
    {
      kind: 'field',
      fieldType: 'text',
      id: 'from_number',
      title: 'Which number replies?',
      help: 'In E.164 form, the way Twilio stores it.',
      required: true,
      placeholder: '+15551234567',
      pattern: '\\+[1-9]\\d{6,14}',
    },
    {
      kind: 'field',
      fieldType: 'multiline',
      id: 'context',
      title: 'What should it know?',
      help: 'Opening hours, what you sell, what you will not answer. The reply is written from this and nothing else.',
      required: true,
      min: 30,
      max: 4000,
    },
    {
      kind: 'field',
      fieldType: 'secret',
      id: 'auth_token',
      title: 'Twilio auth token',
      help: 'Used to verify that an inbound webhook really came from Twilio. Without it the endpoint would answer anyone.',
      required: true,
    },
    {
      kind: 'toggle',
      id: 'whatsapp',
      title: 'Handle WhatsApp too?',
      help: 'Requires the WhatsApp sender to be approved on your Twilio account.',
      required: false,
      default: false,
    },
    projectStep('The go-live checklist is seeded onto this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'inbound',
      name: 'Inbound customer message',
      description: 'Answers an inbound SMS or WhatsApp message and replies on the same channel.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'Inbound message from Twilio',
          config: {
            triggerType: 'webhook',
            // Twilio cannot be made to send a generic HMAC header — it signs the
            // URL plus the sorted form parameters with its own scheme, so a
            // generic verifier would reject every real request and accept none.
            verify: 'twilio',
            secret: '{{setup.auth_token}}',
            source: 'twilio-inbound',
          },
        },
        llm('Write the reply', {
          system: 'You answer customer messages briefly and factually. Use only the context given. If the context does not answer the question, say a person will follow up — never invent a fact.',
          prompt: 'Context:\n\n{{setup.context}}\n\nCustomer said: {{input.Body}}\n\nReply in under 300 characters.',
        }),
        call('Reply on the same channel', 'twilio', 'send_sms', {
          To: '{{input.From}}',
          From: '{{setup.from_number}}',
          Body: '{{input}}',
        }),
      ]),
    },
    {
      kind: 'tasks',
      id: 'go-live',
      label: 'Go-live checklist',
      items: checklist([
        ['Point the Twilio number at the webhook URL', 'Open the workflow, copy its webhook URL, and paste it into the number’s inbound message handler in the Twilio console. Nothing arrives until you do.'],
        ['Send yourself a test message', 'Text the number from your own phone and read the reply. This is the only way to confirm the signature check, the context and the reply path all work together.'],
        ['Write down what it must never answer', 'Refunds, legal questions, anything about pricing you negotiate. Add them to the context as explicit refusals rather than hoping they do not come up.'],
        ['Decide who picks up the handoffs', 'When the reply says a person will follow up, a person has to. Name them.'],
      ]),
    },
  ],
  successCriteria: [
    'A text to your number gets a reply within seconds.',
    'A request signed by anything other than Twilio is rejected.',
    'Questions outside the context are handed off rather than guessed at.',
  ],
};

const phoneVerification: BuiltinTemplate = {
  key: 'phone-verification',
  name: 'Verify a customer’s phone number',
  summary: 'Send a one-time code and check it — the standard flow, wired correctly, in two steps.',
  description:
    'Two endpoints: one that sends a code, one that checks it. Built on Twilio Verify, so the code generation, expiry, rate limiting and retry behaviour are Twilio’s rather than something that has to be got right here.',
  category: 'messaging',
  icon: '🔐',
  tags: ['twilio', 'otp', '2fa', 'verification', 'auth'],
  requiredConnectors: [
    needs('twilio-verify', 'Twilio Verify', 'Codes are issued and checked by Twilio Verify, which owns expiry and rate limiting.'),
  ],
  requiredSecrets: [],
  steps: [
    ask('service_sid', 'Verify Service SID', 'Twilio Console → Verify → Services. Create one if you have not already.', 'VA…'),
    {
      kind: 'choice',
      id: 'channel',
      title: 'How is the code delivered?',
      required: true,
      options: [
        { value: 'sms', label: 'SMS', help: 'The default, and the cheapest.' },
        { value: 'call', label: 'Voice call', help: 'Reaches landlines and numbers that block short codes.' },
        { value: 'whatsapp', label: 'WhatsApp', help: 'Requires an approved WhatsApp sender.' },
      ],
    },
    {
      kind: 'field',
      fieldType: 'secret',
      id: 'auth_token',
      title: 'Twilio auth token',
      help: 'Verifies that the inbound request came from your application, not from someone spraying codes at your customers.',
      required: true,
    },
    projectStep('The verification checklist is seeded onto this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'send-code',
      name: 'Send a verification code',
      description: 'Issues a one-time code to the number in the request.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'Verification requested',
          config: { triggerType: 'webhook', verify: 'hmac', secret: '{{setup.auth_token}}', source: 'verify-start' },
        },
        call('Send the code', 'twilio-verify', 'start_verification', {
          serviceSid: '{{setup.service_sid}}',
          To: '{{input.phone}}',
          Channel: '{{setup.channel}}',
        }),
      ]),
    },
    {
      kind: 'workflow',
      id: 'check-code',
      name: 'Check a verification code',
      description: 'Checks the code the customer entered.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'Code submitted',
          config: { triggerType: 'webhook', verify: 'hmac', secret: '{{setup.auth_token}}', source: 'verify-check' },
        },
        call('Check the code', 'twilio-verify', 'check_verification', {
          serviceSid: '{{setup.service_sid}}',
          To: '{{input.phone}}',
          Code: '{{input.code}}',
        }),
      ]),
    },
    {
      kind: 'tasks',
      id: 'verification-checklist',
      label: 'Verification checklist',
      items: checklist([
        ['Call the send endpoint from your sign-up form', 'Copy the send workflow’s webhook URL into wherever your sign-up form posts. It expects a JSON body with a `phone` field in E.164 form.'],
        ['Handle the approved / pending / canceled statuses', 'Twilio returns a status, not a boolean. Treat anything other than `approved` as a failed check.', 'build'],
        ['Cap retries on your side', 'Twilio rate-limits per number, but your form should stop asking after a handful of attempts rather than relying on that.', 'build'],
      ]),
    },
  ],
  successCriteria: [
    'A code arrives on the channel you chose within seconds.',
    'The right code returns `approved`; a wrong one does not.',
  ],
};

export const MESSAGING_TEMPLATES: readonly BuiltinTemplate[] = [customerLine, phoneVerification];
