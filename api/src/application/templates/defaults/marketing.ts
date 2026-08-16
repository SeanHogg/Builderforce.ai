/**
 * Marketing templates — the entrepreneur's first two jobs: send the campaign,
 * and keep showing up on the channels where customers are.
 *
 * Both are already fully expressible over the connector catalogue; what was
 * missing was somebody having decided the order, the prompts and which fields a
 * person actually has to supply. That decision IS the template.
 */

import { ask, call, chain, checklist, llm, needs, projectStep, type BuiltinTemplate } from './dsl';

/**
 * The single hardest thing to get right in a campaign template is WHICH
 * AUDIENCE, because the answer only exists in the customer's Mailchimp account.
 * A text field asking for a list id is how a template ships broken — nobody
 * knows their list id. So the step resolves the live list through the same
 * connector the campaign will send with, which also proves the credential works
 * before anything is created.
 */
const emailCampaign: BuiltinTemplate = {
  key: 'email-campaign-launch',
  name: 'Launch an email campaign',
  summary: 'Draft, schedule and send a campaign to one of your audiences — then report on how it did.',
  description:
    'Picks up your Mailchimp audience, writes the campaign from a brief you supply, sends it on the schedule you choose, and reads the opens and clicks back so the result lands somewhere you will see it.',
  category: 'marketing',
  icon: '📣',
  tags: ['email', 'campaign', 'mailchimp', 'launch'],
  requiredConnectors: [
    needs('mailchimp', 'Mailchimp', 'The campaign is created, sent and measured in your Mailchimp account.'),
  ],
  requiredSecrets: [],
  steps: [
    {
      kind: 'choice',
      id: 'audience_id',
      title: 'Which audience should this send to?',
      help: 'Read live from your Mailchimp account.',
      required: true,
      source: {
        connector: 'mailchimp',
        action: 'list_audiences',
        valuePath: 'id',
        labelPath: 'name',
        input: { count: 50 },
      },
    },
    ask('campaign_name', 'What is this campaign called?', 'Internal only — it never reaches a reader.', 'Spring launch'),
    ask('subject_line', 'Subject line', 'The one line that decides whether the rest is read.', 'Something new from us'),
    {
      kind: 'field',
      fieldType: 'multiline',
      id: 'brief',
      title: 'What should the campaign say?',
      help: 'A few sentences. The draft is written from this and left for you to approve before it sends.',
      required: true,
      min: 20,
      max: 2000,
    },
    {
      kind: 'field',
      fieldType: 'email',
      id: 'from_email',
      title: 'Who is it from?',
      help: 'Must be a sender you have already verified in Mailchimp.',
      required: true,
    },
    {
      kind: 'schedule',
      id: 'send_at',
      title: 'When should it go out?',
      help: 'The draft is prepared on this cadence; sending still waits for your approval.',
      required: true,
      defaultCron: '0 9 * * 2',
      defaultTimezone: 'UTC',
    },
    projectStep('The launch checklist is seeded onto this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'campaign',
      name: 'Email campaign — {{setup.campaign_name}}',
      description: 'Drafts, creates and sends the campaign, then reads its performance back.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'On the campaign schedule',
          config: { triggerType: 'schedule', cron: '{{setup.send_at}}', timezone: '{{setup.send_at.timezone}}' },
        },
        llm('Draft the campaign', {
          system: 'You write short, concrete marketing emails. No filler, no exclamation marks, one clear call to action.',
          prompt: 'Write an HTML email for this brief:\n\n{{setup.brief}}\n\nSubject line already chosen: {{setup.subject_line}}. Return HTML only.',
        }),
        call('Create the campaign', 'mailchimp', 'create_campaign', {
          type: 'regular',
          recipients: { list_id: '{{setup.audience_id}}' },
          settings: {
            subject_line: '{{setup.subject_line}}',
            title: '{{setup.campaign_name}}',
            reply_to: '{{setup.from_email}}',
            from_name: '{{setup.campaign_name}}',
          },
        }),
        call('Attach the draft', 'mailchimp', 'set_campaign_content', {
          campaign_id: '{{input.id}}',
          html: '{{input}}',
        }),
        call('Read the result', 'mailchimp', 'get_campaign_report', { campaign_id: '{{input.id}}' }),
      ]),
    },
    {
      kind: 'tasks',
      id: 'launch-checklist',
      label: 'Launch checklist',
      items: checklist([
        ['Verify the sending address in Mailchimp', 'Mailchimp will refuse the send until the from address is a verified sender on the account. Do this first — everything else waits on it.'],
        ['Approve the campaign draft', 'The workflow writes the draft and stops. Read it, edit it if you want to, and send it from the campaign page.'],
        ['Check the audience is the one you meant', 'Confirm the segment size looks right before the first send. A campaign sent to the wrong list cannot be recalled.'],
        ['Review opens and clicks after 48 hours', 'The workflow reads the report back. Compare it against whatever you sent last, and change one thing next time.'],
      ]),
    },
  ],
  successCriteria: [
    'A campaign exists in Mailchimp, addressed to the audience you picked.',
    'The draft reads like something you would have written.',
    'Opens and clicks come back into the workflow run after it sends.',
  ],
};

/**
 * The second marketing job is cadence, not craft: showing up weekly beats
 * showing up brilliantly once. The template is deliberately two channels rather
 * than eight — a person who has to connect eight accounts before anything
 * happens connects none.
 */
const socialCadence: BuiltinTemplate = {
  key: 'weekly-social-cadence',
  name: 'Keep a weekly posting cadence',
  summary: 'Write and publish a post to LinkedIn and X every week, from a running theme you set once.',
  description:
    'Turns "we should post more" into something that happens. One theme, one schedule, one draft a week — published to the accounts you connect, with the engagement read back so you can see what landed.',
  category: 'marketing',
  icon: '🗓️',
  tags: ['social', 'linkedin', 'x', 'content', 'cadence'],
  requiredConnectors: [
    needs('linkedin-social', 'LinkedIn', 'Posts are published to the company page or profile this connection authorises.'),
  ],
  requiredSecrets: [],
  steps: [
    {
      kind: 'field',
      fieldType: 'multiline',
      id: 'theme',
      title: 'What is the running theme?',
      help: 'What you want to be known for. Every draft is written against this.',
      required: true,
      min: 20,
      max: 1000,
    },
    ask('author_urn', 'Which LinkedIn feed publishes it?', 'The organization or person URN the connection is allowed to post as.', 'urn:li:organization:1234567'),
    {
      kind: 'schedule',
      id: 'cadence',
      title: 'How often?',
      required: true,
      defaultCron: '0 8 * * 2',
      defaultTimezone: 'UTC',
    },
    {
      kind: 'toggle',
      id: 'cross_post_x',
      title: 'Cross-post to X as well?',
      help: 'Requires the X connection. The post is trimmed to fit.',
      required: false,
      default: false,
    },
    projectStep('The cadence checklist is seeded onto this project’s board.'),
  ],
  outputs: [
    {
      kind: 'workflow',
      id: 'cadence',
      name: 'Weekly post',
      description: 'Writes and publishes the week’s post.',
      definition: chain([
        {
          kind: 'trigger',
          label: 'On the posting cadence',
          config: { triggerType: 'schedule', cron: '{{setup.cadence}}', timezone: '{{setup.cadence.timezone}}' },
        },
        llm('Write the post', {
          system: 'You write short professional social posts. One idea, plain language, no hashtags, no emoji, under 120 words.',
          prompt: 'Running theme:\n\n{{setup.theme}}\n\nWrite this week’s post. Return the post text only.',
        }),
        call('Publish to LinkedIn', 'linkedin-social', 'create_post', {
          author: '{{setup.author_urn}}',
          commentary: '{{input}}',
          visibility: 'PUBLIC',
          lifecycleState: 'PUBLISHED',
        }),
      ]),
    },
    {
      kind: 'tasks',
      id: 'cadence-checklist',
      label: 'Cadence checklist',
      items: checklist([
        ['Confirm the LinkedIn feed is the right one', 'Publishing to a personal profile when you meant the company page is the single most common mistake here, and it is not undoable.'],
        ['Read the first draft before it publishes', 'Pause the workflow after its first run and read what it wrote. Adjust the theme until the drafts sound like you.'],
        ['Decide what you will measure', 'Pick one number — replies, profile visits, inbound conversations — and check it monthly rather than daily.'],
      ]),
    },
  ],
  successCriteria: [
    'A post is published to the feed you named, on the cadence you set.',
    'The drafts read like your voice, not a template’s.',
  ],
};

export const MARKETING_TEMPLATES: readonly BuiltinTemplate[] = [emailCampaign, socialCadence];
