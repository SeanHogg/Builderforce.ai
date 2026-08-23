import type { NodeKindMeta } from '../stepCatalog';

/**
 * CONNECT — the steps that reach something outside the flow
 *
 * The entry point, the agent and model calls, the memory and knowledge reads, and the
 * two integration doors (MCP and the tenant's connector catalog). Everything here talks
 * to a system that is not the workflow.
 *
 * One family per file, assembled by `stepCatalog.ts`. The catalog is ~60 declarations
 * and grows with the product; kept in one file it was the largest module in the tree
 * and every addition edited the same 1,000 lines. A family is a real seam — the palette
 * groups by it, the 3D badge names it, and a new step almost always joins an existing
 * one — so splitting here costs nothing and stops the file from being the place every
 * change collides.
 */
export const CONNECT_STEP_KINDS: NodeKindMeta[] = [
  {
    kind: 'trigger',
    label: 'Trigger',
    icon: '⚡',
    group: 'Trigger',
    accent: 'var(--violet-bright)',
    blurb: 'Entry point that starts the workflow.',
    defaultConfig: { triggerType: 'manual' },
    fields: [
      {
        key: 'triggerType', label: 'Trigger type', type: 'select',
        // Includes Reliability events (a monitor breach / an incident's lifecycle) so a
        // workflow can automate the response, plus marketing / data-collection events so
        // a workflow can start from a captured signal (form, signup, purchase…).
        options: [
          'manual', 'webhook', 'schedule', 'board-event', 'mailbox-received',
          'qa-finding', 'qa-exploration-complete',
          'monitor-breach', 'incident-created', 'incident-resolved', 'incident-status-change',
          'form-submit', 'page-view', 'signup', 'purchase',
          'email-open', 'email-click', 'rss', 'inbound-email', 'integration',
        ],
      },
      { key: 'source', label: 'Source / label', type: 'text', placeholder: 'e.g. pricing-page form, newsletter' },

      // Type-specific options, revealed by the selected trigger type above.
      { key: 'cron', label: 'Cron schedule', type: 'text', placeholder: 'e.g. 0 9 * * 1-5', visibleWhen: { field: 'triggerType', equals: 'schedule' } },
      { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'e.g. UTC, America/New_York', visibleWhen: { field: 'triggerType', equals: 'schedule' } },
      { key: 'webhookPath', label: 'Webhook path', type: 'text', placeholder: 'e.g. /hooks/lead', visibleWhen: { field: 'triggerType', equals: 'webhook' } },
      // Twilio cannot be made to send a generic HMAC header — it signs the URL
      // plus the sorted form parameters with its own scheme. Without this choice
      // a Twilio number could not start a workflow at all.
      { key: 'verify', label: 'Verify caller as', type: 'select', options: ['hmac', 'twilio'], visibleWhen: { field: 'triggerType', equals: 'webhook' } },
      { key: 'secret', label: 'Signing secret / Twilio auth token', type: 'text', placeholder: 'Shared secret, or your Twilio auth token', visibleWhen: { field: 'triggerType', equals: 'webhook' } },
      { key: 'boardEvent', label: 'Board event', type: 'select', options: ['task-created', 'task-moved', 'task-completed', 'comment-added'], visibleWhen: { field: 'triggerType', equals: 'board-event' } },

      // Quality filters (blank = fire on any). The Agentic Tester's severity
      // taxonomy is its own — deliberately not the incident sev1..sev4 scale.
      { key: 'findingSeverity', label: 'Finding severity (blank = any)', type: 'select', options: ['', 'low', 'medium', 'high', 'critical'], visibleWhen: { field: 'triggerType', equals: 'qa-finding' } },
      { key: 'findingType', label: 'Finding type (blank = any)', type: 'select', options: ['', 'console', 'pageerror', 'network', 'navigation', 'assertion', 'crash'], visibleWhen: { field: 'triggerType', equals: 'qa-finding' } },
      { key: 'explorationOutcome', label: 'Run outcome (blank = any)', type: 'select', options: ['', 'passed', 'failed', 'error'], visibleWhen: { field: 'triggerType', equals: 'qa-exploration-complete' } },

      // Reliability event filters (blank = fire on any). severity/affectedSystem apply
      // to every Reliability event; the rest are event-specific. Keys are matched
      // server-side by fireEventTriggers.
      { key: 'severity', label: 'Severity filter (blank = any)', type: 'select', options: ['', 'sev1', 'sev2', 'sev3', 'sev4'], visibleWhen: { field: 'triggerType', equals: ['monitor-breach', 'incident-created', 'incident-resolved', 'incident-status-change'] } },
      { key: 'affectedSystem', label: 'Affected-system filter (blank = any)', type: 'text', placeholder: 'e.g. Payments, Database', visibleWhen: { field: 'triggerType', equals: ['monitor-breach', 'incident-created', 'incident-resolved', 'incident-status-change'] } },
      { key: 'monitorType', label: 'Monitor-type filter (blank = any)', type: 'select', options: ['', 'heartbeat', 'http_check', 'webhook', 'metric_threshold', 'manual'], visibleWhen: { field: 'triggerType', equals: 'monitor-breach' } },
      { key: 'incidentSource', label: 'Incident-source filter (blank = any)', type: 'text', placeholder: 'e.g. monitor, manual, freshdesk', visibleWhen: { field: 'triggerType', equals: 'incident-created' } },
      { key: 'status', label: 'Status filter (blank = any)', type: 'select', options: ['', 'open', 'acknowledged', 'mitigated', 'resolved'], visibleWhen: { field: 'triggerType', equals: 'incident-status-change' } },
      { key: 'formId', label: 'Form id', type: 'text', placeholder: 'Form identifier', visibleWhen: { field: 'triggerType', equals: 'form-submit' } },
      { key: 'pagePath', label: 'Page path', type: 'text', placeholder: 'e.g. /pricing', visibleWhen: { field: 'triggerType', equals: 'page-view' } },
      { key: 'sku', label: 'Product / SKU', type: 'text', placeholder: 'Match a product (blank = any)', visibleWhen: { field: 'triggerType', equals: 'purchase' } },
      { key: 'campaign', label: 'Campaign id', type: 'text', placeholder: 'Email campaign id', visibleWhen: { field: 'triggerType', equals: ['email-open', 'email-click'] } },
      { key: 'feedUrl', label: 'Feed URL', type: 'text', placeholder: 'https://example.com/feed.xml', visibleWhen: { field: 'triggerType', equals: 'rss' } },
      { key: 'pollMinutes', label: 'Poll interval (min)', type: 'number', visibleWhen: { field: 'triggerType', equals: 'rss' } },
      { key: 'inbox', label: 'Inbox address', type: 'text', placeholder: 'e.g. leads@inbound.builderforce.ai', visibleWhen: { field: 'triggerType', equals: 'inbound-email' } },
      // Connected-mailbox filters (blank = fire on any). Both are EXACT matches,
      // because that is what fireEventTriggers does with a saved filter; a
      // workflow that wants a domain or a substring leaves them blank and branches.
      { key: 'mailboxAccount', label: 'Mailbox (blank = any connected)', type: 'text', placeholder: 'e.g. hello@acme.com', visibleWhen: { field: 'triggerType', equals: 'mailbox-received' } },
      { key: 'mailboxSender', label: 'Only from (blank = any sender)', type: 'text', placeholder: 'e.g. billing@vendor.com', visibleWhen: { field: 'triggerType', equals: 'mailbox-received' } },
      { key: 'integrationEvent', label: 'Integration event', type: 'text', placeholder: 'e.g. invoice.paid', visibleWhen: { field: 'triggerType', equals: 'integration' } },
    ],
  },
  {
    kind: 'agent',
    label: 'Agent Run',
    icon: '🤖',
    group: 'Agent',
    accent: 'var(--coral-bright)',
    blurb: 'Run one of your agents (role + runtime + model).',
    defaultConfig: { role: 'code-creator', runtime: 'cloud', model: '', task: '' },
    fields: [
      { key: 'role', label: 'Agent role', type: 'text', placeholder: 'e.g. code-creator, code-reviewer' },
      { key: 'runtime', label: 'Runtime', type: 'select', options: ['cloud', 'browser', 'local', 'remote'] },
      { key: 'model', label: 'Model (blank = default)', type: 'text', placeholder: 'e.g. claude-opus-5' },
      { key: 'task', label: 'Task / prompt', type: 'textarea', placeholder: 'What should this agent do?' },
    ],
  },
  {
    kind: 'memory',
    label: 'Memory',
    icon: '🧠',
    group: 'LLM Logic',
    accent: 'var(--cyan-bright)',
    blurb: 'Recall from or write to the SSM hippocampus memory.',
    defaultConfig: { op: 'recall', query: '', key: '', content: '', limit: 5 },
    fields: [
      { key: 'op', label: 'Operation', type: 'select', options: ['recall', 'write'] },
      { key: 'query', label: 'Recall query', type: 'text', placeholder: 'What to recall (recall op)' },
      { key: 'key', label: 'Memory key', type: 'text', placeholder: 'Key to write (write op)' },
      { key: 'content', label: 'Content', type: 'textarea', placeholder: 'Content to store (write op)' },
      { key: 'limit', label: 'Recall limit', type: 'number' },
    ],
  },
  {
    kind: 'knowledge',
    label: 'Knowledge Base',
    icon: '📚',
    group: 'LLM Logic',
    accent: 'var(--cyan-bright)',
    blurb: 'Query a knowledge base or ingest source text into it.',
    defaultConfig: { op: 'query', query: '', source: '', namespace: '', limit: 5 },
    fields: [
      { key: 'op', label: 'Operation', type: 'select', options: ['query', 'ingest'] },
      { key: 'query', label: 'Query', type: 'text', placeholder: 'Retrieval query (query op)' },
      { key: 'source', label: 'Source text', type: 'textarea', placeholder: 'Text/URL to ingest (ingest op)' },
      { key: 'namespace', label: 'Namespace', type: 'text', placeholder: 'KB namespace (optional)' },
      { key: 'limit', label: 'Top-K', type: 'number' },
    ],
  },
  {
    kind: 'llm',
    label: 'Call LLM',
    icon: '✨',
    group: 'LLM Logic',
    accent: 'var(--purple-bright)',
    blurb: 'Call a model provider (OpenAI, Anthropic, Gemini…) via the gateway.',
    defaultConfig: { provider: 'openai', model: '', system: '', prompt: '', temperature: 0.7 },
    fields: [
      { key: 'provider', label: 'Provider', type: 'text', placeholder: 'openai, anthropic, gemini, mistral…' },
      { key: 'model', label: 'Model (blank = provider default)', type: 'text', placeholder: 'e.g. claude-opus-5, claude-sonnet-5' },
      { key: 'system', label: 'System prompt', type: 'textarea', placeholder: 'Optional system instructions' },
      { key: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'User prompt — supports {{input}}' },
      { key: 'temperature', label: 'Temperature', type: 'number' },
    ],
  },
  {
    kind: 'mcp',
    label: 'MCP Tool',
    icon: '🧩',
    group: 'Integrations',
    accent: 'var(--sky-bright)',
    blurb: 'Invoke an MCP server / SaaS integration tool.',
    defaultConfig: { integration: '', operation: '', params: '{}' },
    fields: [
      { key: 'integration', label: 'Integration', type: 'text', placeholder: 'e.g. github, postgres, slack' },
      { key: 'operation', label: 'Operation', type: 'text', placeholder: 'e.g. create-issue, query' },
      { key: 'params', label: 'Params (JSON)', type: 'textarea', placeholder: '{ "title": "..." }' },
    ],
  },
  {
    kind: 'connector',
    label: 'Integration action',
    icon: '🔌',
    group: 'Integrations',
    accent: 'var(--orange-bright)',
    blurb: 'Call any connected integration — SMS, voice, WhatsApp, email, CRM, payments.',
    // No declared fields: this node's options come from the tenant's LIVE catalog
    // (including connectors they authored), so it renders its own editor —
    // see ConnectorNodeFields.tsx.
    defaultConfig: { connector: '', action: '', input: '{}' },
    fields: [],
  },
  {
    kind: 'gmail',
    label: 'Send Gmail',
    icon: '✉️',
    group: 'Integrations',
    accent: 'var(--red-bright)',
    blurb: 'Send an email through your connected Gmail account.',
    defaultConfig: { to: '', subject: '', body: '{{input}}' },
    fields: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'recipient@example.com — supports {{input}}' },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Email subject — supports {{input}}' },
      { key: 'body', label: 'Body', type: 'textarea', placeholder: 'Email body — {{input}} inserts the upstream output' },
    ],
  },
];
