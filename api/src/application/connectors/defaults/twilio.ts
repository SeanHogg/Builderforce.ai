/**
 * Built-in connectors — the rest of the Twilio platform.
 *
 * `twilio`, `twilio-verify` and `twilio-lookup` live in `communication.ts` with
 * the other messaging vendors. These three are here because they are a different
 * KIND of surface: each is its own Twilio product with its own API host, its own
 * auth shape, and its own reason to exist.
 *
 * Together with the messaging/voice/email/verify connectors this covers every
 * product Twilio's own platform list names — Voice, Email, Messaging, SMS,
 * WhatsApp, **Conversations**, **Customer Data**, Authentication and
 * **Conversational AI** — so a system built here can use any of them rather than
 * the three that happened to be wired first.
 *
 * ── WHY EACH IS SEPARATE FROM `twilio` ──────────────────────────────────────
 * A manifest has ONE `baseUrl` and ONE auth shape. Conversations answers on
 * `conversations.twilio.com`, Assistants on `assistants.twilio.com`, and Segment
 * on `api.segment.io` with a completely different credential (a write key, not
 * an account SID). Folding them into the `twilio` manifest would mean either a
 * per-action base URL — which the manifest format deliberately does not have,
 * because it is what makes an action's target auditable — or three connectors
 * pretending to be one. They are three connectors.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, bo, p, q, qn } from './dsl';

/**
 * Twilio Conversations — one threaded conversation across SMS, WhatsApp and chat.
 *
 * The reason this is not "just messaging": a Conversation is a PARTICIPANT SET
 * with a shared history, so the same thread can reach a customer on WhatsApp and
 * an agent in a chat client without either side knowing the other's channel. The
 * per-message APIs cannot express that — they address one number at a time.
 *
 * ── THE PARAMETER EVERY INTEGRATION GETS WRONG ──────────────────────────────
 * Adding an SMS/WhatsApp participant needs `MessagingBinding.Address` (the
 * customer's number) AND `MessagingBinding.ProxyAddress` (YOUR Twilio number).
 * The dot is part of the wire name, not a nested object, and omitting the proxy
 * address fails with an error that reads like a permissions problem. Both are
 * declared here with explicit wire names so neither is guessed.
 */
const twilioConversations: ConnectorManifest = {
  key: 'twilio-conversations',
  name: 'Twilio Conversations',
  description: 'One threaded conversation per customer across SMS, WhatsApp and chat, with a shared history.',
  category: 'communication',
  icon: '💬',
  baseUrl: 'https://conversations.twilio.com/v1',
  docsUrl: 'https://www.twilio.com/docs/conversations/api',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'username', label: 'API key SID (or Account SID)', secret: false, required: true, placeholder: 'AC… or SK…' },
      { key: 'password', label: 'Auth token (or API key secret)', secret: true, required: true },
    ],
  },
  actions: [
    {
      // Every Conversations endpoint is form-encoded, like the rest of Twilio's
      // REST surface — a JSON body is rejected outright.
      key: 'create_conversation', label: 'Start a conversation', description: 'Open a new conversation thread.',
      method: 'POST', path: '/Conversations', mutates: true, bodyFormat: 'form',
      params: {
        FriendlyName: b('Human-readable name, e.g. "Order 1001 — Ada"'),
        UniqueName: b('Your own id for this thread, so you can address it without storing the SID'),
        Attributes: b('JSON string of your own metadata'),
      },
    },
    {
      key: 'list_conversations', label: 'List conversations', description: 'List conversation threads, newest first.',
      method: 'GET', path: '/Conversations', mutates: false, resultPath: 'conversations',
      params: { PageSize: qn('Max threads to return'), PageToken: q('Pagination token') },
    },
    {
      key: 'add_participant', label: 'Add a participant', description: 'Add a customer (SMS/WhatsApp) or a chat user to the thread.',
      method: 'POST', path: '/Conversations/{ConversationSid}/Participants', mutates: true, bodyFormat: 'form',
      required: ['ConversationSid'],
      params: {
        ConversationSid: p('Conversation SID (CH…) or its UniqueName'),
        // The dot IS the wire name. Declared explicitly so the runtime sends
        // `MessagingBinding.Address` rather than a nested object Twilio ignores.
        address: b('Customer address — a phone number, or whatsapp:+14155551234', { name: 'MessagingBinding.Address' }),
        proxyAddress: b('YOUR Twilio number the customer sees. Required for SMS/WhatsApp participants.', { name: 'MessagingBinding.ProxyAddress' }),
        Identity: b('Chat identity instead of a phone number — for an agent or an app user'),
        Attributes: b('JSON string of your own metadata'),
      },
    },
    {
      key: 'send_conversation_message', label: 'Send a message', description: 'Post a message into the thread; every participant receives it on their own channel.',
      method: 'POST', path: '/Conversations/{ConversationSid}/Messages', mutates: true, bodyFormat: 'form',
      required: ['ConversationSid', 'Body'],
      params: {
        ConversationSid: p('Conversation SID (CH…) or its UniqueName'),
        Body: b('Message text'),
        Author: b('Who it is from — a chat identity or your brand name'),
        MediaSid: b('Attach previously-uploaded media (ME…)'),
      },
    },
    {
      key: 'list_conversation_messages', label: 'Read the thread', description: 'Read messages in a conversation — the shared history across channels.',
      method: 'GET', path: '/Conversations/{ConversationSid}/Messages', mutates: false, resultPath: 'messages',
      required: ['ConversationSid'],
      params: {
        ConversationSid: p('Conversation SID (CH…) or its UniqueName'),
        PageSize: qn('Max messages to return'),
        Order: q('asc | desc'),
      },
    },
  ],
};

/**
 * Twilio Segment — the Customer Data Platform.
 *
 * This is the "Customer Data" product on Twilio's platform list, and it is the
 * piece that makes the other channels personal rather than generic: an identify
 * or track call written here is what a later message reads to know who it is
 * talking to and what they just did.
 *
 * ── WHY THE PASSWORD FIELD IS OPTIONAL AND SAYS SO ──────────────────────────
 * Segment's Tracking API authenticates with HTTP Basic where the WRITE KEY is
 * the username and the password is EMPTY. That is unusual enough that a required
 * password field would make people paste the write key twice and get a 401 they
 * cannot explain.
 */
const twilioSegment: ConnectorManifest = {
  key: 'twilio-segment',
  name: 'Twilio Segment (Customer Data)',
  description: 'Record who a customer is and what they did, so every channel can personalise from one profile.',
  category: 'communication',
  icon: '👤',
  baseUrl: 'https://api.segment.io/v1',
  docsUrl: 'https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'username', label: 'Write key', secret: true, required: true, placeholder: 'Segment source → Settings → API Keys' },
      { key: 'password', label: 'Leave blank', secret: false, required: false, help: 'Segment authenticates with the write key as the username and NO password.' },
    ],
  },
  actions: [
    {
      key: 'identify', label: 'Identify a person', description: 'Create or update a customer profile and its traits.',
      method: 'POST', path: '/identify', mutates: true, required: ['traits'],
      params: {
        userId: b('Your own id for this person. Use this OR anonymousId.'),
        anonymousId: b('Pre-signup id, when you do not know who they are yet'),
        traits: bo('Profile fields, e.g. {"email":"ada@example.com","phone":"+14155551234","plan":"pro"}'),
        context: bo('Request context — locale, page, campaign'),
      },
    },
    {
      key: 'track', label: 'Track an event', description: 'Record something a customer did — the trigger most journeys start from.',
      method: 'POST', path: '/track', mutates: true, required: ['event'],
      params: {
        userId: b('Your own id for this person. Use this OR anonymousId.'),
        anonymousId: b('Pre-signup id'),
        event: b('Event name, e.g. "Order Placed", "Trial Started"'),
        properties: bo('Event fields, e.g. {"orderId":"1001","total":42.5}'),
        context: bo('Request context'),
      },
    },
    {
      key: 'page', label: 'Record a page view', description: 'Record a page or screen view against the profile.',
      method: 'POST', path: '/page', mutates: true,
      params: {
        userId: b('Your own id for this person'),
        anonymousId: b('Pre-signup id'),
        name: b('Page name, e.g. "Pricing"'),
        properties: bo('Page fields, e.g. {"url":"https://example.com/pricing"}'),
      },
    },
    {
      key: 'group', label: 'Associate with an account', description: 'Link a person to a company or account, for B2B journeys.',
      method: 'POST', path: '/group', mutates: true, required: ['groupId'],
      params: {
        userId: b('Your own id for this person'),
        anonymousId: b('Pre-signup id'),
        groupId: b('Your own id for the account/company'),
        traits: bo('Account fields, e.g. {"name":"Acme","plan":"enterprise"}'),
      },
    },
  ],
};

/**
 * Twilio AI Assistants — the Conversational AI product.
 *
 * The REST half of conversational AI: create an assistant with a personality and
 * tools, then send it a turn and get its reply. Pair it with the `<ConversationRelay>`
 * TwiML node (see `application/backend/twiml.ts`) to put the same assistant on a
 * live phone call — the connector handles text channels, the TwiML node handles
 * voice, and both are the same assistant.
 */
const twilioAssistants: ConnectorManifest = {
  key: 'twilio-assistants',
  name: 'Twilio AI Assistants',
  description: 'Create a conversational AI assistant and exchange turns with it over any text channel.',
  category: 'communication',
  icon: '🤖',
  baseUrl: 'https://assistants.twilio.com/v1',
  docsUrl: 'https://www.twilio.com/docs/alpha/ai-assistants',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'username', label: 'API key SID (or Account SID)', secret: false, required: true, placeholder: 'AC… or SK…' },
      { key: 'password', label: 'Auth token (or API key secret)', secret: true, required: true },
    ],
  },
  actions: [
    {
      key: 'create_assistant', label: 'Create an assistant', description: 'Create an assistant with a name and a personality prompt.',
      method: 'POST', path: '/Assistants', mutates: true, required: ['Name'],
      params: {
        Name: b('Assistant name'),
        Personality_prompt: b('System prompt — who the assistant is and what it must never do'),
        Model: b('Model to run the assistant on'),
      },
    },
    {
      key: 'list_assistants', label: 'List assistants', description: 'List the assistants on the account.',
      method: 'GET', path: '/Assistants', mutates: false, resultPath: 'assistants',
      params: { PageSize: qn('Max assistants to return') },
    },
    {
      key: 'send_assistant_message', label: 'Ask the assistant', description: 'Send one turn to the assistant and get its reply.',
      method: 'POST', path: '/Assistants/{AssistantSid}/Messages', mutates: true,
      required: ['AssistantSid', 'Body'],
      params: {
        AssistantSid: p('Assistant SID (aia…)'),
        Body: b('What the customer said'),
        Identity: b('Who is speaking, e.g. phone:+14155551234 — keeps each customer’s history separate'),
        Session_id: b('Continue an existing session instead of starting a new one'),
        Webhook: b('Where to POST the reply, for the asynchronous path'),
      },
    },
  ],
};

export const TWILIO_CONNECTORS: readonly ConnectorManifest[] = [
  twilioConversations,
  twilioSegment,
  twilioAssistants,
];
