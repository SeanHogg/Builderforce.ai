/**
 * Built-in connectors — communication & messaging.
 *
 * These are the actions an agent needs to TELL A HUMAN something, or to reach a
 * customer: post to a channel, send an SMS, send an email. They are deliberately
 * the first category shipped, because a workforce that can act but cannot report
 * is the failure mode every autonomous system falls into.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, bb, bn, bo, p, q, qn, TWILIO_ACCOUNT_SID_FIELD, TWILIO_REST_CREDENTIALS } from './dsl';

const slack: ConnectorManifest = {
  key: 'slack',
  name: 'Slack',
  description: 'Post messages, read channels, and look up teammates in Slack.',
  category: 'communication',
  icon: '💬',
  baseUrl: 'https://slack.com/api',
  docsUrl: 'https://api.slack.com/methods',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'Bot user OAuth token', secret: true, required: true, placeholder: 'xoxb-…', help: 'Slack app → OAuth & Permissions → Bot User OAuth Token' }],
  },
  actions: [
    {
      key: 'post_message', label: 'Post message', description: 'Post a message to a Slack channel or DM.',
      method: 'POST', path: '/chat.postMessage', mutates: true, required: ['channel', 'text'],
      params: {
        channel: b('Channel id (C…) or name (#general)'),
        text: b('Message text — Slack mrkdwn is supported'),
        thread_ts: b('Reply in the thread with this parent timestamp'),
        blocks: ba('Slack Block Kit blocks (optional, overrides plain text rendering)'),
      },
    },
    {
      key: 'list_channels', label: 'List channels', description: 'List public and private channels the bot can see.',
      method: 'GET', path: '/conversations.list', mutates: false, resultPath: 'channels',
      params: { limit: qn('Max channels to return (default 100)'), types: q('Comma list: public_channel,private_channel'), cursor: q('Pagination cursor') },
    },
    {
      key: 'lookup_user_by_email', label: 'Find user by email', description: 'Resolve a Slack user id from an email address.',
      method: 'GET', path: '/users.lookupByEmail', mutates: false, required: ['email'], resultPath: 'user',
      params: { email: q('Email address to resolve') },
    },
    {
      key: 'get_channel_history', label: 'Read channel history', description: 'Read recent messages from a channel.',
      method: 'GET', path: '/conversations.history', mutates: false, required: ['channel'], resultPath: 'messages',
      params: { channel: q('Channel id (C…)'), limit: qn('Max messages (default 50)'), oldest: q('Only messages after this ts') },
    },
    {
      key: 'add_reaction', label: 'Add reaction', description: 'React to a message with an emoji.',
      method: 'POST', path: '/reactions.add', mutates: true, required: ['channel', 'timestamp', 'name'],
      params: { channel: b('Channel id'), timestamp: b('Message ts'), name: b('Emoji name without colons, e.g. white_check_mark') },
    },
  ],
};

const discord: ConnectorManifest = {
  key: 'discord',
  name: 'Discord',
  description: 'Send messages and manage channels in a Discord server.',
  category: 'communication',
  icon: '🎮',
  baseUrl: 'https://discord.com/api/v10',
  docsUrl: 'https://discord.com/developers/docs/reference',
  auth: {
    kind: 'api_key', in: 'header', name: 'Authorization', prefix: 'Bot ',
    fields: [{ key: 'apiKey', label: 'Bot token', secret: true, required: true, help: 'Discord Developer Portal → Bot → Token' }],
  },
  actions: [
    {
      key: 'send_message', label: 'Send message', description: 'Send a message to a Discord channel.',
      method: 'POST', path: '/channels/{channel_id}/messages', mutates: true, required: ['channel_id', 'content'],
      params: { channel_id: p('Discord channel id'), content: b('Message content (≤2000 chars)'), tts: bb('Send as text-to-speech') },
    },
    {
      key: 'list_channels', label: 'List channels', description: 'List the channels in a guild (server).',
      method: 'GET', path: '/guilds/{guild_id}/channels', mutates: false, required: ['guild_id'],
      params: { guild_id: p('Discord guild (server) id') },
    },
    {
      key: 'get_messages', label: 'Read messages', description: 'Read recent messages from a channel.',
      method: 'GET', path: '/channels/{channel_id}/messages', mutates: false, required: ['channel_id'],
      params: { channel_id: p('Discord channel id'), limit: qn('Max messages (1-100)') },
    },
  ],
};

/**
 * Twilio — messaging AND voice.
 *
 * Voice matters as much as messaging here and is easy to get wrong, so the shape
 * is worth stating: an outbound call is placed by POSTing to `/Calls.json` with
 * EITHER a `Url` Twilio fetches TwiML from when the call connects, OR inline
 * `Twiml`. The `Url` form is what click-to-call and outbound IVR use, and it
 * requires an endpoint that serves TwiML — which a project's own webhook ingress
 * now is (`application/backend`), so that field usually takes the project's
 * `/hooks/<token>/...` URL. Any endpoint the tenant already operates works too.
 *
 * `Twiml` (inline) is offered alongside it because the simplest useful call —
 * "ring this number and read them this sentence" — needs no hosted endpoint at
 * all, and requiring one would make the first voice call needlessly hard to place.
 */
const twilio: ConnectorManifest = {
  key: 'twilio',
  name: 'Twilio',
  description: 'Send SMS and WhatsApp messages, place and track voice calls, and look up numbers.',
  category: 'communication',
  icon: '📱',
  baseUrl: 'https://api.twilio.com/2010-04-01/Accounts/{{auth.accountSid}}',
  docsUrl: 'https://www.twilio.com/docs/messaging/api',
  auth: {
    kind: 'basic',
    // The account comes first because the base URL above addresses it; the pair
    // below is the same one every Twilio product takes. See `TWILIO_REST_CREDENTIALS`
    // — this manifest is the reason it is a primitive.
    fields: [TWILIO_ACCOUNT_SID_FIELD, ...TWILIO_REST_CREDENTIALS],
  },
  actions: [
    {
      // Twilio's Messages endpoint rejects a JSON body — form encoding is mandatory.
      key: 'send_sms', label: 'Send SMS', description: 'Send an SMS text message.',
      method: 'POST', path: '/Messages.json', mutates: true, bodyFormat: 'form', required: ['To', 'From', 'Body'],
      params: { To: b('Destination number in E.164, e.g. +14155551234'), From: b('Your Twilio number in E.164'), Body: b('Message text') },
    },
    {
      key: 'send_whatsapp', label: 'Send WhatsApp message', description: 'Send a WhatsApp message via Twilio.',
      method: 'POST', path: '/Messages.json', mutates: true, bodyFormat: 'form', required: ['To', 'From', 'Body'],
      params: {
        To: b('whatsapp:+14155551234'),
        From: b('whatsapp:+<your Twilio WhatsApp number>'),
        Body: b('Message text'),
        // Outside the 24-hour customer-service window WhatsApp accepts ONLY an
        // approved template, addressed by content SID. Without this, every
        // re-engagement send fails with a 63016 that reads like a number problem.
        ContentSid: b('Approved WhatsApp template SID (HX…) — required outside the 24h session window'),
        ContentVariables: b('JSON object of template variables, e.g. {"1":"ACME","2":"12:30"}'),
        MediaUrl: b('Public URL of an image/document to attach'),
      },
    },
    {
      key: 'send_mms', label: 'Send MMS', description: 'Send a picture message (MMS).',
      method: 'POST', path: '/Messages.json', mutates: true, bodyFormat: 'form', required: ['To', 'From', 'MediaUrl'],
      params: {
        To: b('Destination number in E.164'),
        From: b('Your MMS-capable Twilio number in E.164'),
        Body: b('Optional caption'),
        MediaUrl: b('Publicly reachable URL of the image'),
      },
    },
    {
      key: 'list_messages', label: 'List messages', description: 'List recent messages on the account.',
      method: 'GET', path: '/Messages.json', mutates: false, resultPath: 'messages',
      params: { To: q('Filter by destination number'), From: q('Filter by sender number'), PageSize: qn('Results per page') },
    },
    {
      key: 'make_call', label: 'Place a call', description: 'Place an outbound voice call, driven by TwiML.',
      method: 'POST', path: '/Calls.json', mutates: true, bodyFormat: 'form', required: ['To', 'From'],
      params: {
        To: b('Number to call, in E.164'),
        From: b('Your Twilio voice number in E.164'),
        // Supply Url for a webhook-driven call (click-to-call, outbound IVR), or
        // Twiml for a self-contained one. Twilio requires exactly one of them.
        Url: b('URL Twilio fetches TwiML from when the call connects — use this project’s webhook ingress'),
        Twiml: b('Inline TwiML, for a call that needs no webhook, e.g. <Response><Say>Your order shipped.</Say></Response>'),
        StatusCallback: b('URL Twilio POSTs call lifecycle events to'),
        StatusCallbackEvent: b('Which events to report: initiated, ringing, answered, completed'),
        MachineDetection: b('Set to "Enable" to detect answering machines before speaking'),
        Timeout: bn('Seconds to let it ring before giving up'),
        Record: bb('Record the call'),
      },
    },
    {
      key: 'list_calls', label: 'List calls', description: 'List recent calls — the basis of call tracking.',
      method: 'GET', path: '/Calls.json', mutates: false, resultPath: 'calls',
      params: {
        To: q('Filter by called number'),
        From: q('Filter by calling number'),
        Status: q('queued, ringing, in-progress, completed, busy, failed, no-answer'),
        StartTime: q('Only calls on/after this date (YYYY-MM-DD)'),
        PageSize: qn('Results per page'),
      },
    },
    {
      key: 'update_call', label: 'Update a live call', description: 'Redirect or hang up a call that is in progress.',
      method: 'POST', path: '/Calls/{CallSid}.json', mutates: true, bodyFormat: 'form', required: ['CallSid'],
      params: {
        CallSid: p('SID of the live call'),
        Url: b('New TwiML URL to redirect the call to'),
        Twiml: b('Inline TwiML to redirect the call to'),
        Status: b('Set to "completed" to hang up'),
      },
    },
    {
      key: 'list_recordings', label: 'List recordings', description: 'List call recordings.',
      method: 'GET', path: '/Recordings.json', mutates: false, resultPath: 'recordings',
      params: { CallSid: q('Only recordings of this call'), PageSize: qn('Results per page') },
    },
    {
      key: 'list_phone_numbers', label: 'List your numbers', description: 'List the phone numbers on the account and how each is configured.',
      method: 'GET', path: '/IncomingPhoneNumbers.json', mutates: false, resultPath: 'incoming_phone_numbers',
      params: { PhoneNumber: q('Filter by number'), PageSize: qn('Results per page') },
    },
    {
      // The webhook URLs live on the NUMBER, not on the message — this is the action
      // that makes a project's ingress actually receive inbound SMS and calls, so it
      // is the difference between a wired system and a manual console step.
      key: 'configure_number', label: 'Configure a number’s webhooks', description: 'Point a Twilio number at your inbound SMS and voice webhook URLs.',
      method: 'POST', path: '/IncomingPhoneNumbers/{Sid}.json', mutates: true, bodyFormat: 'form', required: ['Sid'],
      params: {
        Sid: p('SID of the phone number (PN…)'),
        SmsUrl: b('Webhook URL for inbound SMS'),
        SmsMethod: b('HTTP method for the SMS webhook (POST)'),
        VoiceUrl: b('Webhook URL for inbound calls'),
        VoiceMethod: b('HTTP method for the voice webhook (POST)'),
        StatusCallback: b('Webhook URL for call status events'),
        FriendlyName: b('Label for the number'),
      },
    },
    {
      // PROVISIONING — the three actions that make a number something a tenant can
      // BUY rather than something an operator pastes in from the console. Search is
      // separate from purchase because a search result expires: Twilio does not hold
      // a number for you, so the buy re-states the E.164 and can legitimately fail
      // with 21422 if somebody else took it first. `application/phone/phoneNumbers.ts`
      // is where that race is handled.
      key: 'search_available_numbers', label: 'Search available numbers',
      description: 'Find purchasable local numbers in a country, optionally near an area code.',
      method: 'GET', path: '/AvailablePhoneNumbers/{CountryCode}/Local.json', mutates: false,
      required: ['CountryCode'], resultPath: 'available_phone_numbers',
      params: {
        CountryCode: p('ISO country code, e.g. US'),
        AreaCode: qn('Restrict to an area code, e.g. 415'),
        Contains: q('Digits or letters the number must contain'),
        SmsEnabled: q('true to require SMS capability'),
        VoiceEnabled: q('true to require voice capability'),
        PageSize: qn('Results per page'),
      },
    },
    {
      key: 'buy_phone_number', label: 'Buy a number',
      description: 'Purchase a phone number onto the account.',
      method: 'POST', path: '/IncomingPhoneNumbers.json', mutates: true, bodyFormat: 'form',
      required: ['PhoneNumber'],
      params: {
        PhoneNumber: b('The E.164 number to purchase, from a search result'),
        FriendlyName: b('Label for the number'),
        SmsUrl: b('Webhook URL for inbound SMS'),
        VoiceUrl: b('Webhook URL for inbound calls'),
        StatusCallback: b('Webhook URL for call status events'),
      },
    },
    {
      key: 'release_phone_number', label: 'Release a number',
      description: 'Give a number back. Billing stops; the number is gone and cannot be reclaimed.',
      method: 'DELETE', path: '/IncomingPhoneNumbers/{Sid}.json', mutates: true, required: ['Sid'],
      params: { Sid: p('SID of the phone number (PN…)') },
    },
  ],
};

/**
 * Twilio Lookup and Verify live on a DIFFERENT host (`lookups`/`verify`.twilio.com)
 * with a different path root, and a connector manifest has one base URL. Splitting
 * them out is therefore not a taxonomy choice — a single manifest physically
 * cannot address both. They share the same account credentials.
 */
const twilioVerify: ConnectorManifest = {
  key: 'twilio-verify',
  name: 'Twilio Verify & Lookup',
  description: 'Phone verification (OTP) and number intelligence — carrier, line type, reachability.',
  category: 'communication',
  icon: '🔐',
  baseUrl: 'https://verify.twilio.com/v2',
  docsUrl: 'https://www.twilio.com/docs/verify/api',
  auth: {
    kind: 'basic',
    fields: [
      ...TWILIO_REST_CREDENTIALS,
      { key: 'serviceSid', label: 'Verify Service SID', secret: false, required: false, placeholder: 'VA…', help: 'Twilio Console → Verify → Services' },
    ],
  },
  actions: [
    {
      key: 'start_verification', label: 'Send a verification code', description: 'Send a one-time code by SMS, call or WhatsApp.',
      method: 'POST', path: '/Services/{ServiceSid}/Verifications', mutates: true, bodyFormat: 'form', required: ['To', 'Channel'],
      params: {
        ServiceSid: p('Verify Service SID', { default: '{{auth.serviceSid}}' }),
        To: b('Number in E.164'),
        Channel: b('sms, call, whatsapp or email', { enum: ['sms', 'call', 'whatsapp', 'email'] }),
      },
    },
    {
      key: 'check_verification', label: 'Check a verification code', description: 'Check a code the user entered.',
      method: 'POST', path: '/Services/{ServiceSid}/VerificationCheck', mutates: true, bodyFormat: 'form', required: ['To', 'Code'],
      params: {
        ServiceSid: p('Verify Service SID', { default: '{{auth.serviceSid}}' }),
        To: b('Number the code was sent to, in E.164'),
        Code: b('Code the user entered'),
      },
    },
  ],
};

const twilioLookup: ConnectorManifest = {
  key: 'twilio-lookup',
  name: 'Twilio Lookup',
  description: 'Validate a phone number and read its carrier and line type before you spend a message on it.',
  category: 'communication',
  icon: '🔎',
  baseUrl: 'https://lookups.twilio.com/v2',
  docsUrl: 'https://www.twilio.com/docs/lookup/v2-api',
  auth: {
    kind: 'basic',
    fields: [...TWILIO_REST_CREDENTIALS],
  },
  actions: [
    {
      key: 'lookup_number', label: 'Look up a number', description: 'Validate a number and optionally fetch carrier / line-type intelligence.',
      method: 'GET', path: '/PhoneNumbers/{PhoneNumber}', mutates: false, required: ['PhoneNumber'],
      params: {
        PhoneNumber: p('Number in E.164, e.g. +14155551234'),
        Fields: q('Comma list of data packages, e.g. line_type_intelligence,caller_name'),
      },
    },
  ],
};

const sendgrid: ConnectorManifest = {
  key: 'sendgrid',
  name: 'SendGrid',
  description: 'Send transactional email through SendGrid.',
  category: 'communication',
  icon: '📧',
  baseUrl: 'https://api.sendgrid.com/v3',
  docsUrl: 'https://www.twilio.com/docs/sendgrid/api-reference',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'SendGrid API key', secret: true, required: true, placeholder: 'SG.…' }] },
  actions: [
    {
      key: 'send_email', label: 'Send email', description: 'Send a plain-text email to one recipient.',
      method: 'POST', path: '/mail/send', mutates: true, required: ['to', 'from', 'subject', 'body'],
      params: {
        to: b('Recipient email address', { bodyPath: 'personalizations.0.to.0.email' }),
        from: b('Verified sender email address', { bodyPath: 'from.email' }),
        fromName: b('Sender display name', { bodyPath: 'from.name' }),
        replyTo: b('Reply-To address', { bodyPath: 'reply_to.email' }),
        subject: b('Subject line', { bodyPath: 'personalizations.0.subject' }),
        body: b('Plain-text body', { bodyPath: 'content.0.value' }),
      },
      bodyTemplate: { content: [{ type: 'text/plain', value: '' }] },
    },
    {
      // A receipt or a password reset is HTML in practice, and SendGrid's content
      // array is ORDER-SENSITIVE — `text/plain` must precede `text/html` or the
      // API rejects the send. Pinning both slots in the template is what stops
      // that from being a runtime surprise per caller.
      key: 'send_html_email', label: 'Send HTML email', description: 'Send an HTML email with a plain-text fallback.',
      method: 'POST', path: '/mail/send', mutates: true, required: ['to', 'from', 'subject', 'html'],
      params: {
        to: b('Recipient email address', { bodyPath: 'personalizations.0.to.0.email' }),
        from: b('Verified sender email address', { bodyPath: 'from.email' }),
        fromName: b('Sender display name', { bodyPath: 'from.name' }),
        subject: b('Subject line', { bodyPath: 'personalizations.0.subject' }),
        text: b('Plain-text fallback (spam filters penalise HTML-only mail)', { bodyPath: 'content.0.value' }),
        html: b('HTML body', { bodyPath: 'content.1.value' }),
      },
      bodyTemplate: {
        content: [
          { type: 'text/plain', value: ' ' },
          { type: 'text/html', value: '' },
        ],
      },
    },
    {
      key: 'send_template_email', label: 'Send a dynamic template', description: 'Send a SendGrid dynamic template with substitution data.',
      method: 'POST', path: '/mail/send', mutates: true, required: ['to', 'from', 'templateId'],
      params: {
        to: b('Recipient email address', { bodyPath: 'personalizations.0.to.0.email' }),
        from: b('Verified sender email address', { bodyPath: 'from.email' }),
        templateId: b('Dynamic template id (d-…)', { bodyPath: 'template_id' }),
        data: bo('Template variables, e.g. {"first_name":"Ada","order_id":"1234"}', { bodyPath: 'personalizations.0.dynamic_template_data' }),
      },
    },
    {
      key: 'list_suppressions', label: 'List bounces', description: 'List bounced addresses (deliverability triage).',
      method: 'GET', path: '/suppression/bounces', mutates: false,
      params: { limit: qn('Max results'), start_time: qn('Unix timestamp lower bound') },
    },
    {
      key: 'get_email_stats', label: 'Email stats', description: 'Delivered / opened / clicked / bounced counts by day.',
      method: 'GET', path: '/stats', mutates: false, required: ['start_date'],
      params: {
        start_date: q('Start date, YYYY-MM-DD'),
        end_date: q('End date, YYYY-MM-DD'),
        aggregated_by: q('day, week or month'),
      },
    },
  ],
};

export const COMMUNICATION_CONNECTORS: readonly ConnectorManifest[] = [
  slack,
  discord,
  twilio,
  twilioVerify,
  twilioLookup,
  sendgrid,
];
