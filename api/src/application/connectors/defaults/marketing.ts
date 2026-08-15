/**
 * Built-in LIFECYCLE marketing platforms — the list-and-send systems a company already
 * runs its audience on.
 *
 * These are not a competitor to the campaign engine in `application/marketing`; they are
 * the reason it must not be the only door. A company arriving with 40,000 contacts in
 * Mailchimp is not going to re-import them to send one campaign, and the audience of
 * record is wherever their unsubscribe list lives. Reading a list from here and sending
 * FROM here keeps consent in one place — which is the whole point of a suppression list.
 *
 * No dedicated port: these have no cross-vendor operation the platform performs on its
 * own behalf, so they are reachable through the generic connector tool surface like any
 * other manifest. A port would be an abstraction over one call site.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, bo, p, q, qn } from './dsl';

const mailchimp: ConnectorManifest = {
  key: 'mailchimp', name: 'Mailchimp', category: 'marketing', icon: '🐵',
  description: 'Read audiences and send or schedule email campaigns from Mailchimp.',
  // The data centre is part of every Mailchimp URL and differs per account, so it is a
  // connection field — the same reason Zendesk's subdomain is one.
  baseUrl: 'https://{{auth.dc}}.api.mailchimp.com/3.0', docsUrl: 'https://mailchimp.com/developer/marketing/api/',
  auth: { kind: 'basic', fields: [
    { key: 'username', label: 'Username', secret: false, required: true, placeholder: 'anystring', help: 'Mailchimp ignores this — any non-empty value works.' },
    { key: 'password', label: 'API key', secret: true, required: true, placeholder: '…-us21' },
    { key: 'dc', label: 'Data centre', secret: false, required: true, placeholder: 'us21', help: 'The suffix on your API key, after the dash.' },
  ] },
  actions: [
    { key: 'list_audiences', label: 'List audiences', description: 'List the audiences (lists) on the account with their member counts.', method: 'GET', path: '/lists', mutates: false, resultPath: 'lists', params: { count: qn('Page size'), offset: qn('Row offset') } },
    { key: 'list_members', label: 'List audience members', description: 'Read the contacts in an audience and their subscription status.', method: 'GET', path: '/lists/{list_id}/members', mutates: false, required: ['list_id'], resultPath: 'members', params: { list_id: p('Audience id'), status: q('subscribed, unsubscribed, cleaned or pending'), count: qn('Page size'), offset: qn('Row offset'), since_last_changed: q('ISO 8601 lower bound') } },
    { key: 'add_member', label: 'Add or update a contact', description: 'Add a contact to an audience, or update one already in it.', method: 'POST', path: '/lists/{list_id}/members', mutates: true, required: ['list_id', 'email_address', 'status'], params: { list_id: p('Audience id'), email_address: b('Contact email'), status: b('subscribed, unsubscribed, pending or transactional'), merge_fields: bo('Merge fields such as FNAME and LNAME'), tags: ba('Tags to apply') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create an email campaign against an audience.', method: 'POST', path: '/campaigns', mutates: true, required: ['type'], params: { type: b('regular, plaintext, absplit, rss or variate'), recipients: bo('Audience selection, e.g. {"list_id":"abc123"}'), settings: bo('Subject line, title, from name and reply-to'), schedule_time: b('ISO 8601 send time') } },
    { key: 'set_campaign_content', label: 'Set campaign content', description: 'Set the HTML or template content of a campaign before it sends.', method: 'PUT', path: '/campaigns/{campaign_id}/content', mutates: true, required: ['campaign_id'], params: { campaign_id: p('Campaign id'), html: b('Campaign HTML'), plain_text: b('Plain-text alternative'), template: bo('Template reference and section content') } },
    { key: 'send_campaign', label: 'Send campaign', description: 'Send a Mailchimp campaign immediately. This reaches real inboxes.', method: 'POST', path: '/campaigns/{campaign_id}/actions/send', mutates: true, required: ['campaign_id'], params: { campaign_id: p('Campaign id') } },
    { key: 'get_campaign_report', label: 'Get campaign report', description: 'Read opens, clicks, bounces and unsubscribes for a sent campaign.', method: 'GET', path: '/reports/{campaign_id}', mutates: false, required: ['campaign_id'], params: { campaign_id: p('Campaign id') } },
  ],
};

const klaviyo: ConnectorManifest = {
  key: 'klaviyo', name: 'Klaviyo', category: 'marketing', icon: '◆',
  description: 'Read profiles and lists and trigger email or SMS campaigns from Klaviyo.',
  baseUrl: 'https://a.klaviyo.com/api', docsUrl: 'https://developers.klaviyo.com/en/reference/api_overview',
  // Klaviyo pins its API by date header and rejects a call without one, so it is a
  // default header rather than something every action has to remember.
  defaultHeaders: { revision: '2026-01-15' },
  auth: { kind: 'api_key', in: 'header', name: 'Authorization', prefix: 'Klaviyo-API-Key ', fields: [
    { key: 'apiKey', label: 'Private API key', secret: true, required: true, placeholder: 'pk_…', help: 'Klaviyo → Settings → API keys, with the scopes the actions you use need.' },
  ] },
  actions: [
    { key: 'list_lists', label: 'List lists', description: 'List the Klaviyo lists on the account.', method: 'GET', path: '/lists', mutates: false, resultPath: 'data', params: { 'page[size]': qn('Page size'), 'page[cursor]': q('Pagination cursor') } },
    { key: 'list_profiles', label: 'List profiles', description: 'Read contact profiles and their subscription state.', method: 'GET', path: '/profiles', mutates: false, resultPath: 'data', params: { filter: q('Filter expression, e.g. equals(email,"a@b.com")'), 'page[size]': qn('Page size'), 'page[cursor]': q('Pagination cursor'), sort: q('Sort field, e.g. -created') } },
    { key: 'create_profile', label: 'Create or update a profile', description: 'Create a contact profile, or update one that already exists.', method: 'POST', path: '/profile-import', mutates: true, required: ['data'], params: { data: bo('JSON:API resource object of type profile with attributes.email') } },
    { key: 'subscribe_profiles', label: 'Subscribe profiles to a list', description: 'Add profiles to a Klaviyo list with explicit consent recorded.', method: 'POST', path: '/profile-subscription-bulk-create-jobs', mutates: true, required: ['data'], params: { data: bo('Bulk subscription job resource naming the list and the profiles') } },
    { key: 'list_campaigns', label: 'List campaigns', description: 'Read Klaviyo campaigns and their status.', method: 'GET', path: '/campaigns', mutates: false, resultPath: 'data', params: { filter: q('Required filter, e.g. equals(messages.channel,"email")'), 'page[cursor]': q('Pagination cursor'), sort: q('Sort field') } },
    { key: 'create_campaign', label: 'Create campaign', description: 'Create a Klaviyo email or SMS campaign against an audience.', method: 'POST', path: '/campaigns', mutates: true, required: ['data'], params: { data: bo('JSON:API campaign resource with audiences, send_strategy and campaign-messages') } },
    { key: 'send_campaign', label: 'Send campaign', description: 'Trigger a Klaviyo campaign send job. This reaches real inboxes or handsets.', method: 'POST', path: '/campaign-send-jobs', mutates: true, required: ['data'], params: { data: bo('JSON:API campaign-send-job resource naming the campaign id') } },
    { key: 'get_campaign_values', label: 'Get campaign performance', description: 'Read opens, clicks, conversions and revenue attributed to campaigns.', method: 'POST', path: '/campaign-values-reports', mutates: false, required: ['data'], params: { data: bo('Report resource with statistics, timeframe and conversion_metric_id') } },
  ],
};

const brevo: ConnectorManifest = {
  key: 'brevo', name: 'Brevo', category: 'marketing', icon: '◇',
  description: 'Read contacts and send email or SMS campaigns from Brevo.',
  baseUrl: 'https://api.brevo.com/v3', docsUrl: 'https://developers.brevo.com/reference',
  auth: { kind: 'api_key', in: 'header', name: 'api-key', fields: [
    { key: 'apiKey', label: 'API key', secret: true, required: true, placeholder: 'xkeysib-…', help: 'Brevo → SMTP & API → API keys.' },
  ] },
  actions: [
    { key: 'list_contact_lists', label: 'List contact lists', description: 'List the contact lists on the account with their sizes.', method: 'GET', path: '/contacts/lists', mutates: false, resultPath: 'lists', params: { limit: qn('Page size'), offset: qn('Row offset') } },
    { key: 'list_contacts', label: 'List contacts', description: 'Read contacts, optionally scoped to one list.', method: 'GET', path: '/contacts', mutates: false, resultPath: 'contacts', params: { limit: qn('Page size'), offset: qn('Row offset'), listIds: q('Comma list of list ids'), modifiedSince: q('ISO 8601 lower bound') } },
    { key: 'create_contact', label: 'Create or update a contact', description: 'Create a contact, or update one that already exists.', method: 'POST', path: '/contacts', mutates: true, required: ['email'], params: { email: b('Contact email'), attributes: bo('Contact attributes such as FIRSTNAME and LASTNAME'), listIds: ba('List ids to add the contact to'), updateEnabled: { type: 'boolean', in: 'body', description: 'Update the contact when it already exists instead of failing', default: true } } },
    { key: 'create_email_campaign', label: 'Create email campaign', description: 'Create a Brevo email campaign against one or more lists.', method: 'POST', path: '/emailCampaigns', mutates: true, required: ['name', 'subject', 'sender'], params: { name: b('Campaign name'), subject: b('Subject line'), sender: bo('Sender object with name and email'), htmlContent: b('Campaign HTML'), recipients: bo('Recipient selection, e.g. {"listIds":[2]}'), scheduledAt: b('ISO 8601 send time'), replyTo: b('Reply-to address') } },
    { key: 'send_email_campaign', label: 'Send email campaign', description: 'Send a Brevo campaign immediately. This reaches real inboxes.', method: 'POST', path: '/emailCampaigns/{campaign_id}/sendNow', mutates: true, required: ['campaign_id'], params: { campaign_id: p('Campaign id') } },
    { key: 'get_email_campaign', label: 'Get campaign report', description: 'Read delivery, opens, clicks and unsubscribes for a Brevo campaign.', method: 'GET', path: '/emailCampaigns/{campaign_id}', mutates: false, required: ['campaign_id'], params: { campaign_id: p('Campaign id') } },
    { key: 'send_transactional_email', label: 'Send a transactional email', description: 'Send one message through Brevo rather than a campaign to a list.', method: 'POST', path: '/smtp/email', mutates: true, required: ['to'], params: { to: ba('Array of {email,name} recipients'), sender: bo('Sender object with name and email'), subject: b('Subject line'), htmlContent: b('Message HTML'), textContent: b('Plain-text alternative'), templateId: { type: 'number', in: 'body', description: 'Brevo template to render instead of inline content' }, params: bo('Template parameters') } },
  ],
};

export const MARKETING_PLATFORM_CONNECTORS: readonly ConnectorManifest[] = [mailchimp, klaviyo, brevo];
