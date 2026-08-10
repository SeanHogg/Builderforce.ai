/**
 * Built-in connectors — CRM, billing and customer support.
 *
 * The systems of record a business actually runs on. Actions here are weighted
 * toward READ + CREATE rather than bulk mutation: an agent that can look a customer
 * up and open a record is useful on day one; one that can mass-update a CRM is a
 * liability until the approval gates around it are proven.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, bn, bo, p, q, qn } from './dsl';

const hubspot: ConnectorManifest = {
  key: 'hubspot',
  name: 'HubSpot',
  description: 'Create and search contacts, companies, deals and notes in HubSpot.',
  category: 'crm',
  icon: '🧲',
  baseUrl: 'https://api.hubapi.com',
  docsUrl: 'https://developers.hubspot.com/docs/api/overview',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'Private app access token', secret: true, required: true, placeholder: 'pat-…', help: 'HubSpot → Settings → Integrations → Private apps' }],
  },
  actions: [
    {
      key: 'create_contact', label: 'Create contact', description: 'Create a contact record.',
      method: 'POST', path: '/crm/v3/objects/contacts', mutates: true, required: ['email'],
      params: {
        email: b('Contact email', { bodyPath: 'properties.email' }),
        firstname: b('First name', { bodyPath: 'properties.firstname' }),
        lastname: b('Last name', { bodyPath: 'properties.lastname' }),
        company: b('Company name', { bodyPath: 'properties.company' }),
        phone: b('Phone number', { bodyPath: 'properties.phone' }),
      },
    },
    {
      key: 'search_contacts', label: 'Search contacts', description: 'Search contacts with a HubSpot filter query.',
      method: 'POST', path: '/crm/v3/objects/contacts/search', mutates: false, resultPath: 'results',
      params: { query: b('Free-text search string'), limit: bn('Max results (default 10)') },
    },
    {
      key: 'create_deal', label: 'Create deal', description: 'Open a deal in a pipeline stage.',
      method: 'POST', path: '/crm/v3/objects/deals', mutates: true, required: ['dealname'],
      params: {
        dealname: b('Deal name', { bodyPath: 'properties.dealname' }),
        amount: b('Deal amount', { bodyPath: 'properties.amount' }),
        dealstage: b('Pipeline stage id', { bodyPath: 'properties.dealstage' }),
        pipeline: b('Pipeline id', { bodyPath: 'properties.pipeline' }),
        closedate: b('Expected close date (ISO 8601)', { bodyPath: 'properties.closedate' }),
      },
    },
    {
      key: 'list_deals', label: 'List deals', description: 'List deals with their properties.',
      method: 'GET', path: '/crm/v3/objects/deals', mutates: false, resultPath: 'results',
      params: { limit: qn('Max results'), after: q('Pagination cursor'), properties: q('Comma-separated properties to return') },
    },
  ],
};

const salesforce: ConnectorManifest = {
  key: 'salesforce',
  name: 'Salesforce',
  description: 'Run SOQL queries and create or update records in Salesforce.',
  category: 'crm',
  icon: '☁️',
  baseUrl: 'https://{{auth.instance}}.my.salesforce.com/services/data/v60.0',
  docsUrl: 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/',
  auth: {
    kind: 'bearer',
    fields: [
      { key: 'instance', label: 'Instance', secret: false, required: true, placeholder: 'acme', help: 'The subdomain of your My Domain URL' },
      { key: 'token', label: 'OAuth access token', secret: true, required: true },
    ],
  },
  actions: [
    {
      key: 'query', label: 'SOQL query', description: 'Run a SOQL query and return the records.',
      method: 'GET', path: '/query', mutates: false, required: ['q'], resultPath: 'records',
      params: { q: q('SOQL, e.g. SELECT Id, Name FROM Account LIMIT 10') },
    },
    {
      key: 'create_record', label: 'Create record', description: 'Create a record of any sObject type.',
      method: 'POST', path: '/sobjects/{sobject}', mutates: true, required: ['sobject', 'fields'],
      params: { sobject: p('sObject API name, e.g. Account or Lead'), fields: bo('Field map, e.g. { "Name": "Acme Ltd" }') },
    },
    {
      key: 'update_record', label: 'Update record', description: 'Patch fields on an existing record.',
      method: 'PATCH', path: '/sobjects/{sobject}/{id}', mutates: true, required: ['sobject', 'id', 'fields'],
      params: { sobject: p('sObject API name'), id: p('Record id'), fields: bo('Field map to update') },
    },
  ],
};

const pipedrive: ConnectorManifest = {
  key: 'pipedrive',
  name: 'Pipedrive',
  description: 'Manage deals, persons and activities in Pipedrive.',
  category: 'crm',
  icon: '🟩',
  baseUrl: 'https://api.pipedrive.com/v1',
  docsUrl: 'https://developers.pipedrive.com/docs/api/v1',
  auth: {
    kind: 'api_key', in: 'query', name: 'api_token',
    fields: [{ key: 'apiKey', label: 'API token', secret: true, required: true, help: 'Pipedrive → Personal preferences → API' }],
  },
  actions: [
    {
      key: 'create_deal', label: 'Create deal', description: 'Create a deal.',
      method: 'POST', path: '/deals', mutates: true, required: ['title'],
      params: { title: b('Deal title'), value: b('Deal value'), currency: b('ISO currency code'), person_id: bn('Linked person id'), stage_id: bn('Pipeline stage id') },
    },
    {
      key: 'list_deals', label: 'List deals', description: 'List deals, optionally filtered by status.',
      method: 'GET', path: '/deals', mutates: false, resultPath: 'data',
      params: { status: q('open | won | lost | deleted | all_not_deleted'), limit: qn('Max results'), start: qn('Pagination offset') },
    },
    {
      key: 'create_person', label: 'Create person', description: 'Create a contact person.',
      method: 'POST', path: '/persons', mutates: true, required: ['name'],
      params: { name: b('Full name'), email: b('Email address'), phone: b('Phone number'), org_id: bn('Organisation id') },
    },
  ],
};

const stripe: ConnectorManifest = {
  key: 'stripe',
  name: 'Stripe',
  description: 'Look up customers, charges and subscriptions, and issue refunds.',
  category: 'finance',
  icon: '💳',
  baseUrl: 'https://api.stripe.com/v1',
  docsUrl: 'https://docs.stripe.com/api',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Secret key', secret: true, required: true, placeholder: 'sk_live_…' }] },
  actions: [
    // Stripe's API is form-encoded end to end; a JSON body is rejected outright.
    {
      key: 'create_customer', label: 'Create customer', description: 'Create a Stripe customer.',
      method: 'POST', path: '/customers', mutates: true, bodyFormat: 'form', required: ['email'],
      params: { email: b('Customer email'), name: b('Customer name'), description: b('Internal description') },
    },
    {
      key: 'list_customers', label: 'List customers', description: 'List customers, newest first.',
      method: 'GET', path: '/customers', mutates: false, resultPath: 'data',
      params: { limit: qn('Max results (1-100)'), email: q('Filter by exact email'), starting_after: q('Pagination cursor') },
    },
    {
      key: 'list_charges', label: 'List charges', description: 'List recent charges.',
      method: 'GET', path: '/charges', mutates: false, resultPath: 'data',
      params: { limit: qn('Max results (1-100)'), customer: q('Filter by customer id') },
    },
    {
      key: 'list_subscriptions', label: 'List subscriptions', description: 'List subscriptions and their status.',
      method: 'GET', path: '/subscriptions', mutates: false, resultPath: 'data',
      params: { limit: qn('Max results'), customer: q('Filter by customer id'), status: q('active | past_due | canceled | all') },
    },
    {
      key: 'create_refund', label: 'Refund a charge', description: 'Refund a charge in full or in part.',
      method: 'POST', path: '/refunds', mutates: true, bodyFormat: 'form', required: ['charge'],
      params: { charge: b('Charge id (ch_…)'), amount: b('Amount in the smallest currency unit; omit for full refund'), reason: b('duplicate | fraudulent | requested_by_customer') },
    },
  ],
};

const zendesk: ConnectorManifest = {
  key: 'zendesk',
  name: 'Zendesk',
  description: 'Create, search and comment on Zendesk support tickets.',
  category: 'support',
  icon: '🎧',
  baseUrl: 'https://{{auth.subdomain}}.zendesk.com/api/v2',
  docsUrl: 'https://developer.zendesk.com/api-reference/',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'subdomain', label: 'Subdomain', secret: false, required: true, placeholder: 'acme', help: 'The acme in acme.zendesk.com' },
      { key: 'username', label: 'Email + /token', secret: false, required: true, placeholder: 'you@acme.com/token' },
      { key: 'password', label: 'API token', secret: true, required: true },
    ],
  },
  actions: [
    {
      key: 'create_ticket', label: 'Create ticket', description: 'Open a support ticket.',
      method: 'POST', path: '/tickets.json', mutates: true, required: ['subject', 'comment'],
      params: {
        subject: b('Ticket subject', { bodyPath: 'ticket.subject' }),
        comment: b('First comment body', { bodyPath: 'ticket.comment.body' }),
        priority: b('urgent | high | normal | low', { bodyPath: 'ticket.priority', enum: ['urgent', 'high', 'normal', 'low'] }),
        requester_email: b('Requester email', { bodyPath: 'ticket.requester.email' }),
      },
    },
    {
      key: 'search_tickets', label: 'Search tickets', description: 'Search tickets with Zendesk search syntax.',
      method: 'GET', path: '/search.json', mutates: false, required: ['query'], resultPath: 'results',
      params: { query: q('e.g. type:ticket status:open priority:high'), sort_by: q('created_at | updated_at | priority | status') },
    },
    {
      key: 'add_comment', label: 'Add comment', description: 'Add a public or internal comment to a ticket.',
      method: 'PUT', path: '/tickets/{id}.json', mutates: true, required: ['id', 'body'],
      params: {
        id: p('Ticket id'),
        body: b('Comment body', { bodyPath: 'ticket.comment.body' }),
        public: b('true for a customer-visible reply, false for an internal note', { bodyPath: 'ticket.comment.public', enum: ['true', 'false'] }),
      },
    },
  ],
};

const intercom: ConnectorManifest = {
  key: 'intercom',
  name: 'Intercom',
  description: 'Manage contacts and conversations in Intercom.',
  category: 'support',
  icon: '💠',
  baseUrl: 'https://api.intercom.io',
  docsUrl: 'https://developers.intercom.com/docs/references/rest-api/',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Access token', secret: true, required: true }] },
  defaultHeaders: { 'Intercom-Version': '2.11' },
  actions: [
    {
      key: 'create_contact', label: 'Create contact', description: 'Create a contact (lead or user).',
      method: 'POST', path: '/contacts', mutates: true, required: ['email'],
      params: { email: b('Contact email'), name: b('Full name'), role: b('user | lead', { enum: ['user', 'lead'] }), phone: b('Phone number') },
    },
    {
      key: 'search_contacts', label: 'Search contacts', description: 'Search contacts by a field value.',
      method: 'POST', path: '/contacts/search', mutates: false, required: ['field', 'value'], resultPath: 'data',
      params: {
        field: b('Field to match, e.g. email', { bodyPath: 'query.field' }),
        value: b('Value to match', { bodyPath: 'query.value' }),
      },
      bodyTemplate: { query: { operator: '=' } },
    },
    {
      key: 'reply_to_conversation', label: 'Reply to conversation', description: 'Post an admin reply on a conversation.',
      method: 'POST', path: '/conversations/{id}/reply', mutates: true, required: ['id', 'body', 'admin_id'],
      params: { id: p('Conversation id'), body: b('Reply body (HTML allowed)'), admin_id: b('Admin id sending the reply') },
      bodyTemplate: { message_type: 'comment', type: 'admin' },
    },
  ],
};

const freshdesk: ConnectorManifest = {
  key: 'freshdesk',
  name: 'Freshdesk',
  description: 'Create and list Freshdesk help-desk tickets.',
  category: 'support',
  icon: '🌿',
  baseUrl: 'https://{{auth.domain}}.freshdesk.com/api/v2',
  docsUrl: 'https://developers.freshdesk.com/api/',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'domain', label: 'Domain', secret: false, required: true, placeholder: 'acme', help: 'The acme in acme.freshdesk.com' },
      { key: 'username', label: 'API key', secret: true, required: true },
      { key: 'password', label: 'Password', secret: false, required: true, placeholder: 'X', help: 'Freshdesk ignores this — the literal X is conventional' },
    ],
  },
  actions: [
    {
      key: 'create_ticket', label: 'Create ticket', description: 'Open a help-desk ticket.',
      method: 'POST', path: '/tickets', mutates: true, required: ['subject', 'description', 'email'],
      params: {
        subject: b('Ticket subject'), description: b('Ticket description (HTML)'), email: b('Requester email'),
        priority: bn('1 low · 2 medium · 3 high · 4 urgent'), status: bn('2 open · 3 pending · 4 resolved · 5 closed'),
      },
    },
    {
      key: 'list_tickets', label: 'List tickets', description: 'List tickets, newest first.',
      method: 'GET', path: '/tickets', mutates: false,
      params: { filter: q('new_and_my_open | watching | spam | deleted'), per_page: qn('Results per page'), page: qn('Page number') },
    },
  ],
};

export const BUSINESS_CONNECTORS: readonly ConnectorManifest[] = [
  hubspot, salesforce, pipedrive, stripe, zendesk, intercom, freshdesk,
];
