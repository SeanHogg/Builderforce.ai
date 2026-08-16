/**
 * The templates a company runs on: filling a role, catching a lead, answering a
 * ticket, and getting paid.
 *
 * Grouped in one file on purpose. They are four different departments but the
 * same shape — an event arrives, a model reads it, an integration is called, and
 * a human is left with the part that needs judgement — and keeping them side by
 * side is what stops the fifth one being written differently.
 */

import { ask, call, chain, checklist, llm, needs, projectStep, type BuiltinTemplate } from './dsl';

const openRole: BuiltinTemplate = {
  key: 'open-role-pipeline',
  name: 'Fill an open role',
  summary: 'Publish the role, read every application as it arrives, and put a shortlist on the board.',
  description:
    'Publishes to your job board, then reads applications on a schedule and summarises each candidate against the role before anyone spends time on them. The screening is a recommendation with reasons, never a decision.',
  category: 'hiring',
  icon: '🧑‍💼',
  tags: ['hiring', 'recruiting', 'greenhouse', 'screening'],
  requiredConnectors: [
    needs('greenhouse-job-board', 'Greenhouse', 'The posting is published to, and applications are read from, your Greenhouse job board.'),
  ],
  requiredSecrets: [],
  steps: [
    ask('role_title', 'What is the role?', 'The title as a candidate will read it.', 'Senior Backend Engineer'),
    {
      kind: 'field',
      fieldType: 'multiline',
      id: 'role_brief',
      title: 'What does the person need to be able to do?',
      help: 'Written as capabilities rather than years. This is what every application is screened against, so vagueness here produces vague screening.',
      required: true,
      min: 40,
      max: 4000,
    },
    ask('board_token', 'Greenhouse board token', 'The board identifier in your Greenhouse job-board URL.', 'acme'),
    {
      kind: 'schedule',
      id: 'screen_cadence',
      title: 'How often should applications be screened?',
      required: true,
      defaultCron: '0 8 * * 1-5',
      defaultTimezone: 'UTC',
    },
    projectStep('Screening summaries and the hiring checklist are filed on this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'screen',
      name: 'Screen applications — {{setup.role_title}}',
      description: 'Reads new applications and summarises each candidate against the role.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'On the screening cadence',
          config: { triggerType: 'schedule', cron: '{{setup.screen_cadence}}', timezone: '{{setup.screen_cadence.timezone}}' },
        },
        call('Read new applications', 'greenhouse-job-board', 'list_applications', {}),
        llm('Summarise each candidate', {
          system:
            'You summarise job applications for a hiring manager. State evidence, not impressions. Never infer anything about a candidate that is not written in their application, and never comment on anything outside their ability to do the work.',
          prompt:
            'Role: {{setup.role_title}}\n\nWhat the person needs to be able to do:\n{{setup.role_brief}}\n\nApplications:\n{{input}}\n\nFor each candidate give three lines: what they have evidently done, what is missing against the brief, and one question worth asking them.',
        }),
      ]),
    },
    {
      kind: 'tasks',
      id: 'hiring-checklist',
      label: 'Hiring checklist',
      items: checklist([
        ['Publish the posting', 'Create the job on your Greenhouse board. The screening workflow reads applications from it, so nothing happens until the posting is live.'],
        ['Agree the bar before the first candidate', 'Write down what a yes looks like while nobody real is in front of you. Deciding it afterwards is how the bar moves to fit whoever applied.'],
        ['Read the first batch of summaries yourself', 'Check the summaries against the applications. If a summary is generous or harsh, the brief needs to be more specific — not the prompt.'],
        ['Reply to everyone', 'Including the people you are not taking forward. This is the part every pipeline skips, and the part candidates remember.'],
      ]),
    },
  ],
  successCriteria: [
    'The role is live on your board.',
    'Each new application produces a summary with evidence and a question.',
    'Nothing is rejected automatically.',
  ],
};

const leadRouter: BuiltinTemplate = {
  key: 'inbound-lead-router',
  name: 'Catch and route inbound leads',
  summary: 'Every enquiry lands in the CRM, gets a first read, and reaches whoever should answer it — within minutes.',
  description:
    'A form or webhook posts an enquiry, the lead is created in HubSpot, and the first read — what they want, how urgent it looks, what to ask — goes to the person who owns it. Speed of first reply is the number this exists to move.',
  category: 'sales',
  icon: '🎯',
  tags: ['sales', 'leads', 'crm', 'hubspot', 'routing'],
  requiredConnectors: [
    needs('hubspot', 'HubSpot', 'Every enquiry is written to HubSpot so the pipeline is the CRM rather than an inbox.'),
  ],
  requiredSecrets: [],
  steps: [
    {
      kind: 'field',
      fieldType: 'secret',
      id: 'form_secret',
      title: 'Signing secret for your form',
      help: 'Shared with whatever posts the enquiry, so the endpoint cannot be filled with junk by anyone who finds the URL.',
      required: true,
    },
    {
      kind: 'field',
      fieldType: 'multiline',
      id: 'qualification',
      title: 'What makes a lead worth answering first?',
      help: 'Company size, budget, the words they used. The first read is written against this.',
      required: true,
      min: 20,
      max: 2000,
    },
    {
      kind: 'field',
      fieldType: 'email',
      id: 'owner_email',
      title: 'Who owns new leads?',
      help: 'Where the first read is sent.',
      required: true,
    },
    projectStep('The routing checklist is seeded onto this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'route',
      name: 'Inbound lead',
      description: 'Creates the contact, writes the first read, and sends it to the owner.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'Enquiry submitted',
          config: { triggerType: 'webhook', verify: 'hmac', secret: '{{setup.form_secret}}', source: 'inbound-lead' },
        },
        call('Create the contact', 'hubspot', 'create_contact', {
          properties: {
            email: '{{input.email}}',
            firstname: '{{input.name}}',
            company: '{{input.company}}',
          },
        }),
        llm('Write the first read', {
          system: 'You brief a salesperson on a new enquiry in under 120 words. Say what they asked for, what you can tell about fit, and the one question to open with.',
          prompt: 'What makes a lead worth answering first:\n{{setup.qualification}}\n\nThe enquiry:\n{{input}}',
        }),
        {
          kind: 'gmail',
          label: 'Send it to the owner',
          config: {
            to: '{{setup.owner_email}}',
            subject: 'New enquiry',
            body: '{{input}}',
          },
        },
      ]),
    },
    {
      kind: 'tasks',
      id: 'routing-checklist',
      label: 'Routing checklist',
      items: checklist([
        ['Point your form at the webhook URL', 'Copy the workflow’s webhook URL into your form’s post target, and sign the request with the secret you just set.'],
        ['Agree a first-reply target', 'Pick a number — an hour, a day — and hold it. A router that delivers leads nobody answers faster is not an improvement.'],
        ['Check the CRM fields match yours', 'The workflow writes email, first name and company. If your pipeline needs more, add the properties to the create step.', 'build'],
      ]),
    },
  ],
  successCriteria: [
    'A test submission creates a HubSpot contact.',
    'The owner receives a first read within a minute of the enquiry.',
  ],
};

const supportDesk: BuiltinTemplate = {
  key: 'support-triage-desk',
  name: 'Triage support tickets',
  summary: 'Every new ticket gets read, categorised and prioritised before a person opens it.',
  description:
    'Reads open tickets on a schedule, classifies each against your own categories, and adds an internal note with the likely answer. The reply to the customer stays a human decision — a wrong confident answer costs more than a slow one.',
  category: 'support',
  icon: '🎧',
  tags: ['support', 'zendesk', 'triage', 'tickets'],
  requiredConnectors: [
    needs('zendesk', 'Zendesk', 'Tickets are read from and annotated in your Zendesk account.'),
  ],
  requiredSecrets: [],
  steps: [
    {
      kind: 'field',
      fieldType: 'multiline',
      id: 'categories',
      title: 'What are your ticket categories?',
      help: 'One per line. Tickets are classified into these and nothing else, so a missing category becomes a mis-filed ticket.',
      required: true,
      min: 10,
      max: 1000,
    },
    {
      kind: 'field',
      fieldType: 'multiline',
      id: 'known_answers',
      title: 'What do you answer most often?',
      help: 'The handful of answers that cover most tickets. The internal note is drawn from these.',
      required: true,
      min: 20,
      max: 4000,
    },
    {
      kind: 'schedule',
      id: 'triage_cadence',
      title: 'How often should the queue be triaged?',
      required: true,
      defaultCron: '*/30 * * * *',
      defaultTimezone: 'UTC',
    },
    projectStep('The triage checklist is seeded onto this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'triage',
      name: 'Triage the support queue',
      description: 'Reads open tickets and annotates each with a category and a likely answer.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'On the triage cadence',
          config: { triggerType: 'schedule', cron: '{{setup.triage_cadence}}', timezone: '{{setup.triage_cadence.timezone}}' },
        },
        call('Read open tickets', 'zendesk', 'search_tickets', { query: 'type:ticket status:open' }),
        llm('Classify and draft', {
          system:
            'You triage support tickets. Classify strictly into the given categories — if none fits, say "uncategorised" rather than inventing one. Draft the likely answer only from the known answers given; if none applies, say so.',
          prompt: 'Categories:\n{{setup.categories}}\n\nWhat we usually answer:\n{{setup.known_answers}}\n\nOpen tickets:\n{{input}}',
        }),
      ]),
    },
    {
      kind: 'tasks',
      id: 'triage-checklist',
      label: 'Triage checklist',
      items: checklist([
        ['Check the categories against last month’s tickets', 'Run your own eye down the last fifty. A category list that misses a real theme sends those tickets to "uncategorised" forever.'],
        ['Keep replies human for the first two weeks', 'Read the drafted answers before anyone sends one. The draft is a starting point until you have seen it be right repeatedly.'],
        ['Add an escalation rule', 'Decide what jumps the queue — an outage, a churn risk, a named account — and make sure triage flags it rather than filing it.'],
      ]),
    },
  ],
  successCriteria: [
    'Open tickets carry a category and a suggested answer within the cadence you set.',
    'Nothing is sent to a customer without a person reading it.',
  ],
};

const paymentRecovery: BuiltinTemplate = {
  key: 'failed-payment-recovery',
  name: 'Recover failed payments',
  summary: 'Find the subscriptions that fell over, tell the customer plainly, and track what came back.',
  description:
    'Reads past-due subscriptions on a schedule and writes each customer a short, non-accusatory message with a link to fix their card. Involuntary churn is the cheapest revenue there is to recover and the easiest to never get round to.',
  category: 'finance',
  icon: '💳',
  tags: ['stripe', 'dunning', 'churn', 'billing', 'revenue'],
  requiredConnectors: [
    needs('stripe', 'Stripe', 'Past-due subscriptions and the customers behind them are read from Stripe.'),
    needs('sendgrid', 'SendGrid', 'The recovery emails are sent from your verified sending domain.'),
  ],
  requiredSecrets: [],
  steps: [
    {
      kind: 'field',
      fieldType: 'email',
      id: 'from_email',
      title: 'Who does the email come from?',
      help: 'Must be verified in SendGrid. A billing email from an unverified sender goes to spam, which is the one place it must not go.',
      required: true,
    },
    ask('update_url', 'Where do customers update their card?', 'Your billing portal link. It goes in every message.', 'https://billing.example.com'),
    {
      kind: 'schedule',
      id: 'sweep_cadence',
      title: 'How often should past-due accounts be swept?',
      required: true,
      defaultCron: '0 10 * * *',
      defaultTimezone: 'UTC',
    },
    projectStep('The recovery checklist is seeded onto this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'recover',
      name: 'Recover past-due subscriptions',
      description: 'Finds past-due subscriptions and emails each customer a plain fix-it message.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'On the recovery sweep',
          config: { triggerType: 'schedule', cron: '{{setup.sweep_cadence}}', timezone: '{{setup.sweep_cadence.timezone}}' },
        },
        call('Find past-due subscriptions', 'stripe', 'list_subscriptions', { status: 'past_due', limit: 100 }),
        llm('Write the message', {
          system:
            'You write short billing emails. The tone is neutral and helpful — a card expired, that is all. Never imply the customer did something wrong, never threaten, and always give the link.',
          prompt: 'Update link: {{setup.update_url}}\n\nPast-due subscriptions:\n{{input}}\n\nWrite one short email per customer. Plain text.',
        }),
        call('Send it', 'sendgrid', 'send_email', {
          to: '{{input.email}}',
          from: '{{setup.from_email}}',
          subject: 'Your payment did not go through',
          text: '{{input}}',
        }),
      ]),
    },
    {
      kind: 'tasks',
      id: 'recovery-checklist',
      label: 'Recovery checklist',
      items: checklist([
        ['Verify the sending domain in SendGrid', 'A billing email from an unauthenticated domain lands in spam. Set up domain authentication before the first sweep, not after.'],
        ['Check the billing portal link works while signed out', 'The customer clicking it is not signed in. If the link needs a session, it is the wrong link.'],
        ['Stop emailing accounts that have cancelled', 'Past-due and cancelled are different states. Chasing somebody who already left is the fastest way to a complaint.', 'build'],
        ['Track what came back', 'Compare recovered revenue against the sweep after a month. If it is not moving, the message is the problem, not the cadence.'],
      ]),
    },
  ],
  successCriteria: [
    'Past-due customers receive one clear message with a working link.',
    'Cancelled accounts are left alone.',
    'You can say how much revenue the sweep recovered.',
  ],
};

export const BUSINESS_TEMPLATES: readonly BuiltinTemplate[] = [
  openRole,
  leadRouter,
  supportDesk,
  paymentRecovery,
];
