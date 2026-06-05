import type { WorkflowNodeKind } from '@/lib/builderforceApi';

/**
 * Integration registry — the catalog of MCP servers, LLM platforms, and
 * data-collection sources the builder palette exposes as droppable nodes.
 *
 * Each integration is a *preset* over one of three generic node kinds:
 *   - `llm`     → call a model provider through the Builderforce gateway
 *   - `mcp`     → invoke an MCP-server / SaaS tool
 *   - `trigger` → a data-collection / marketing entry point
 *
 * Keeping integrations here (data, not bespoke node kinds) keeps the contract
 * union small while the palette stays rich and searchable. The list is seeded
 * here and expanded from the `mcp-integration-research` registry.
 */

export type IntegrationKind = Extract<WorkflowNodeKind, 'llm' | 'mcp' | 'trigger'>;
export type IntegrationAuth = 'api-key' | 'oauth' | 'none' | 'connection-string';

export interface IntegrationOperation {
  id: string;
  label: string;
}

export interface Integration {
  id: string;
  label: string;
  /** Category id from INTEGRATION_CATEGORIES. */
  category: string;
  kind: IntegrationKind;
  description: string;
  auth: IntegrationAuth;
  operations: IntegrationOperation[];
  /** Optional emoji override; falls back to the category icon. */
  icon?: string;
}

export interface IntegrationCategory {
  id: string;
  label: string;
  icon: string;
  accent: string;
  order: number;
}

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  { id: 'llm', label: 'LLM Platforms', icon: '✨', accent: '#a855f7', order: 1 },
  { id: 'official', label: 'Core MCP Servers', icon: '🧩', accent: '#38bdf8', order: 2 },
  { id: 'data-db', label: 'Data & Databases', icon: '🗄️', accent: '#34d399', order: 3 },
  { id: 'productivity', label: 'Productivity & Docs', icon: '📋', accent: '#fbbf24', order: 4 },
  { id: 'comms', label: 'Communication', icon: '💬', accent: '#60a5fa', order: 5 },
  { id: 'marketing-crm', label: 'Marketing & CRM', icon: '📣', accent: '#fb7185', order: 6 },
  { id: 'analytics-collection', label: 'Analytics & Data Collection', icon: '📊', accent: '#f472b6', order: 7 },
];

const CATEGORY_MAP: Record<string, IntegrationCategory> = INTEGRATION_CATEGORIES.reduce(
  (acc, c) => { acc[c.id] = c; return acc; },
  {} as Record<string, IntegrationCategory>,
);

/** Accent color for an integration, derived from its category. */
export function integrationAccent(category: string): string {
  return CATEGORY_MAP[category]?.accent ?? 'var(--text-muted)';
}

/** Display icon for an integration (own icon, else category icon). */
export function integrationIcon(integ: Integration): string {
  return integ.icon ?? CATEGORY_MAP[integ.category]?.icon ?? '🔌';
}

// Catalog compiled from the `mcp-integration-research` workflow (73 entries).
// Icons are display-only; the category icon is the fallback.
export const INTEGRATIONS: Integration[] = [
  // ── LLM platforms ────────────────────────────────────────────────────────
  { id: 'openai', label: 'OpenAI', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🤖', description: 'GPT models for chat, embeddings, image generation, and transcription.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'image-generation', label: 'Generate image' }, { id: 'transcription', label: 'Transcribe audio' }] },
  { id: 'anthropic', label: 'Anthropic Claude', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🧠', description: 'Claude models for messages, tool use, and vision.', operations: [{ id: 'chat-completion', label: 'Create message' }, { id: 'tool-use', label: 'Tool use / function calling' }, { id: 'vision', label: 'Analyze image' }] },
  { id: 'google-gemini', label: 'Google Gemini', category: 'llm', kind: 'llm', auth: 'api-key', icon: '♊', description: 'Gemini models for chat, long-context, embeddings, and vision.', operations: [{ id: 'chat-completion', label: 'Generate content' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'vision', label: 'Multimodal / vision' }, { id: 'image-generation', label: 'Generate image' }] },
  { id: 'mistral', label: 'Mistral AI', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🌬️', description: 'Chat, code, and embedding models with EU data residency.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'code-completion', label: 'Codestral completion' }] },
  { id: 'cohere', label: 'Cohere', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🔗', description: 'Command, Embed, and Rerank models for RAG pipelines.', operations: [{ id: 'chat-completion', label: 'Chat' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'rerank', label: 'Rerank documents' }] },
  { id: 'perplexity', label: 'Perplexity', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🔮', description: 'Sonar models for web-grounded answers with citations.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'web-search', label: 'Grounded search answer' }] },
  { id: 'groq', label: 'Groq', category: 'llm', kind: 'llm', auth: 'api-key', icon: '⚡', description: 'Open models at high speed on Groq LPU inference.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'transcription', label: 'Transcribe audio (Whisper)' }] },
  { id: 'openrouter', label: 'OpenRouter', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🛣️', description: 'Unified gateway routing to 500+ models across providers.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'list-models', label: 'List models' }] },
  { id: 'together', label: 'Together AI', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🤝', description: 'Open-source LLMs, embeddings, and image models (OpenAI-compatible).', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'image-generation', label: 'Generate image' }] },
  { id: 'deepseek', label: 'DeepSeek', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🐳', description: 'Chat and reasoning models (OpenAI-compatible).', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'reasoning', label: 'Reasoning completion' }] },
  { id: 'xai-grok', label: 'xAI Grok', category: 'llm', kind: 'llm', auth: 'api-key', icon: '✖️', description: 'Grok models for chat, reasoning, and agentic tool calling.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'tool-use', label: 'Agentic tool calling' }, { id: 'vision', label: 'Image understanding' }] },
  { id: 'ollama', label: 'Ollama', category: 'llm', kind: 'llm', auth: 'none', icon: '🦙', description: 'Local open-weight models for chat and embeddings on your host.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'list-models', label: 'List local models' }] },
  { id: 'azure-openai', label: 'Azure OpenAI', category: 'llm', kind: 'llm', auth: 'api-key', icon: '☁️', description: 'OpenAI models hosted on Azure with enterprise compliance.', operations: [{ id: 'chat-completion', label: 'Chat completion' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'image-generation', label: 'Generate image (DALL-E)' }] },
  { id: 'amazon-bedrock', label: 'Amazon Bedrock', category: 'llm', kind: 'llm', auth: 'api-key', icon: '🪨', description: 'Foundation models (Claude, Llama, Titan…) via AWS Bedrock.', operations: [{ id: 'chat-completion', label: 'Invoke / Converse' }, { id: 'embeddings', label: 'Create embeddings' }, { id: 'image-generation', label: 'Generate image' }] },

  // ── Core MCP servers ─────────────────────────────────────────────────────
  { id: 'filesystem', label: 'Filesystem', category: 'official', kind: 'mcp', auth: 'none', icon: '📁', description: 'Secure local file operations with configurable access controls.', operations: [{ id: 'read-file', label: 'Read file' }, { id: 'write-file', label: 'Write file' }, { id: 'list-directory', label: 'List directory' }, { id: 'search-files', label: 'Search files' }] },
  { id: 'git', label: 'Git', category: 'official', kind: 'mcp', auth: 'none', icon: '🔧', description: 'Read, search, and manipulate local Git repositories.', operations: [{ id: 'git-status', label: 'Get status' }, { id: 'git-diff', label: 'Show diff' }, { id: 'git-commit', label: 'Create commit' }, { id: 'git-log', label: 'View log' }] },
  { id: 'fetch', label: 'Fetch', category: 'official', kind: 'trigger', auth: 'none', icon: '🌐', description: 'Fetch web content and convert HTML to markdown.', operations: [{ id: 'fetch-url', label: 'Fetch URL' }, { id: 'fetch-markdown', label: 'Fetch as markdown' }] },
  { id: 'memory', label: 'Memory (KG)', category: 'official', kind: 'mcp', auth: 'none', icon: '🗃️', description: 'Knowledge-graph persistent memory for entities and relations.', operations: [{ id: 'create-entities', label: 'Create entities' }, { id: 'create-relations', label: 'Create relations' }, { id: 'search-nodes', label: 'Search nodes' }, { id: 'read-graph', label: 'Read graph' }] },
  { id: 'sequential-thinking', label: 'Sequential Thinking', category: 'official', kind: 'mcp', auth: 'none', icon: '🧮', description: 'Structured, reflective step-by-step reasoning.', operations: [{ id: 'add-thought', label: 'Add thought' }, { id: 'revise-thought', label: 'Revise thought' }, { id: 'branch-thought', label: 'Branch thought' }] },
  { id: 'time', label: 'Time', category: 'official', kind: 'mcp', auth: 'none', icon: '⏰', description: 'Current time lookup and timezone conversion.', operations: [{ id: 'get-current-time', label: 'Get current time' }, { id: 'convert-time', label: 'Convert timezone' }] },
  { id: 'github', label: 'GitHub', category: 'official', kind: 'mcp', auth: 'api-key', icon: '🐙', description: 'Repos, files, issues, and pull requests via the GitHub API.', operations: [{ id: 'create-issue', label: 'Create issue' }, { id: 'create-pull-request', label: 'Create pull request' }, { id: 'search-repositories', label: 'Search repositories' }, { id: 'create-or-update-file', label: 'Create or update file' }] },
  { id: 'gitlab', label: 'GitLab', category: 'official', kind: 'mcp', auth: 'api-key', icon: '🦊', description: 'Projects, files, and merge requests via the GitLab API.', operations: [{ id: 'create-issue', label: 'Create issue' }, { id: 'create-merge-request', label: 'Create merge request' }, { id: 'search-projects', label: 'Search projects' }, { id: 'create-or-update-file', label: 'Create or update file' }] },
  { id: 'brave-search', label: 'Brave Search', category: 'official', kind: 'trigger', auth: 'api-key', icon: '🦁', description: 'Web and local search via the Brave Search API.', operations: [{ id: 'web-search', label: 'Web search' }, { id: 'local-search', label: 'Local search' }] },
  { id: 'google-drive', label: 'Google Drive', category: 'official', kind: 'trigger', auth: 'oauth', icon: '📂', description: 'File access and search across Google Drive.', operations: [{ id: 'search-files', label: 'Search files' }, { id: 'read-file', label: 'Read file' }, { id: 'list-files', label: 'List files' }] },
  { id: 'sqlite', label: 'SQLite', category: 'official', kind: 'mcp', auth: 'connection-string', icon: '🪶', description: 'SQLite database interaction with query execution.', operations: [{ id: 'read-query', label: 'Read query' }, { id: 'write-query', label: 'Write query' }, { id: 'list-tables', label: 'List tables' }, { id: 'create-table', label: 'Create table' }] },

  // ── Data & databases ─────────────────────────────────────────────────────
  { id: 'postgres', label: 'PostgreSQL', category: 'data-db', kind: 'mcp', auth: 'connection-string', icon: '🐘', description: 'Schema inspection and SQL query execution.', operations: [{ id: 'run-query', label: 'Run SQL query' }, { id: 'list-tables', label: 'List tables' }, { id: 'describe-schema', label: 'Describe schema' }, { id: 'execute-statement', label: 'Execute statement' }] },
  { id: 'mysql', label: 'MySQL', category: 'data-db', kind: 'mcp', auth: 'connection-string', icon: '🐬', description: 'Query and manage MySQL with schema introspection.', operations: [{ id: 'run-query', label: 'Run SQL query' }, { id: 'list-tables', label: 'List tables' }, { id: 'describe-table', label: 'Describe table' }, { id: 'execute-statement', label: 'Execute statement' }] },
  { id: 'mongodb', label: 'MongoDB', category: 'data-db', kind: 'mcp', auth: 'connection-string', icon: '🍃', description: 'Query collections and manage MongoDB / Atlas.', operations: [{ id: 'find-documents', label: 'Find documents' }, { id: 'insert-document', label: 'Insert document' }, { id: 'update-document', label: 'Update document' }, { id: 'aggregate', label: 'Run aggregation' }, { id: 'list-collections', label: 'List collections' }] },
  { id: 'supabase', label: 'Supabase', category: 'data-db', kind: 'mcp', auth: 'oauth', icon: '⚡', description: 'Tables, queries, and edge functions on Supabase.', operations: [{ id: 'run-sql', label: 'Run SQL' }, { id: 'list-tables', label: 'List tables' }, { id: 'create-table', label: 'Create table' }, { id: 'invoke-edge-function', label: 'Invoke edge function' }] },
  { id: 'snowflake', label: 'Snowflake', category: 'data-db', kind: 'mcp', auth: 'connection-string', icon: '❄️', description: 'SQL execution, object management, and Cortex queries.', operations: [{ id: 'execute-sql', label: 'Execute SQL' }, { id: 'list-databases', label: 'List databases' }, { id: 'query-semantic-view', label: 'Query semantic view' }, { id: 'manage-objects', label: 'Manage objects' }] },
  { id: 'bigquery', label: 'Google BigQuery', category: 'data-db', kind: 'mcp', auth: 'oauth', icon: '🔷', description: 'Query BigQuery datasets with SQL and schema access.', operations: [{ id: 'run-query', label: 'Run query' }, { id: 'list-datasets', label: 'List datasets' }, { id: 'list-tables', label: 'List tables' }, { id: 'get-table-schema', label: 'Get table schema' }] },
  { id: 'redis', label: 'Redis', category: 'data-db', kind: 'mcp', auth: 'connection-string', icon: '🟥', description: 'Read, write, and search across Redis data structures.', operations: [{ id: 'get-key', label: 'Get key' }, { id: 'set-key', label: 'Set key' }, { id: 'delete-key', label: 'Delete key' }, { id: 'search', label: 'Search index' }] },
  { id: 'elasticsearch', label: 'Elasticsearch', category: 'data-db', kind: 'mcp', auth: 'api-key', icon: '🔍', description: 'Search indices, inspect mappings, retrieve documents.', operations: [{ id: 'search', label: 'Search documents' }, { id: 'list-indices', label: 'List indices' }, { id: 'get-mapping', label: 'Get index mapping' }, { id: 'index-document', label: 'Index document' }] },
  { id: 'clickhouse', label: 'ClickHouse', category: 'data-db', kind: 'mcp', auth: 'connection-string', icon: '🏠', description: 'Schema inspection and analytical SQL queries.', operations: [{ id: 'run-query', label: 'Run query' }, { id: 'list-databases', label: 'List databases' }, { id: 'list-tables', label: 'List tables' }, { id: 'describe-table', label: 'Describe table' }] },
  { id: 'neon', label: 'Neon', category: 'data-db', kind: 'mcp', auth: 'oauth', icon: '🟢', description: 'Serverless Postgres with branch-based migrations.', operations: [{ id: 'run-sql', label: 'Run SQL' }, { id: 'create-branch', label: 'Create branch' }, { id: 'list-projects', label: 'List projects' }, { id: 'run-migration', label: 'Run migration' }] },
  { id: 'planetscale', label: 'PlanetScale', category: 'data-db', kind: 'mcp', auth: 'oauth', icon: '🪐', description: 'Databases, branches, schema, and Insights data.', operations: [{ id: 'run-query', label: 'Run query' }, { id: 'list-databases', label: 'List databases' }, { id: 'list-branches', label: 'List branches' }, { id: 'get-insights', label: 'Get Insights data' }] },
  { id: 'google-cloud-sql', label: 'Google Cloud SQL', category: 'data-db', kind: 'mcp', auth: 'oauth', icon: '☁️', description: 'Manage and query Cloud SQL instances.', operations: [{ id: 'run-query', label: 'Run query' }, { id: 'list-instances', label: 'List instances' }, { id: 'list-databases', label: 'List databases' }, { id: 'describe-schema', label: 'Describe schema' }] },
  { id: 'airtable', label: 'Airtable', category: 'data-db', kind: 'mcp', auth: 'api-key', icon: '📊', description: 'Structured records via the Airtable API.', operations: [{ id: 'list-records', label: 'List records' }, { id: 'create-record', label: 'Create record' }, { id: 'update-record', label: 'Update record' }, { id: 'delete-record', label: 'Delete record' }, { id: 'list-bases', label: 'List bases' }] },

  // ── Productivity & docs ──────────────────────────────────────────────────
  { id: 'notion', label: 'Notion', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '📝', description: 'Notes, docs, wikis, and databases.', operations: [{ id: 'search', label: 'Search workspace' }, { id: 'create-page', label: 'Create page' }, { id: 'update-page', label: 'Update page' }, { id: 'query-database', label: 'Query database' }, { id: 'get-page', label: 'Get page content' }] },
  { id: 'linear', label: 'Linear', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '📐', description: 'Issue tracking and project management.', operations: [{ id: 'create-issue', label: 'Create issue' }, { id: 'update-issue', label: 'Update issue' }, { id: 'search-issues', label: 'Search issues' }, { id: 'list-projects', label: 'List projects' }, { id: 'add-comment', label: 'Add comment' }] },
  { id: 'jira', label: 'Jira', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '🟦', description: 'Agile issue and project tracking (Rovo MCP).', operations: [{ id: 'create-issue', label: 'Create issue' }, { id: 'update-issue', label: 'Update issue' }, { id: 'search-jql', label: 'Search issues (JQL)' }, { id: 'transition-issue', label: 'Transition status' }, { id: 'add-comment', label: 'Add comment' }] },
  { id: 'confluence', label: 'Confluence', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '🌐', description: 'Team wiki and documentation (Rovo MCP).', operations: [{ id: 'create-page', label: 'Create page' }, { id: 'update-page', label: 'Update page' }, { id: 'search-content', label: 'Search content' }, { id: 'get-page', label: 'Get page' }] },
  { id: 'asana', label: 'Asana', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '🅰️', description: 'Work management for tasks and projects.', operations: [{ id: 'create-task', label: 'Create task' }, { id: 'update-task', label: 'Update task' }, { id: 'search-tasks', label: 'Search tasks' }, { id: 'list-projects', label: 'List projects' }, { id: 'add-comment', label: 'Add comment' }] },
  { id: 'clickup', label: 'ClickUp', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '⬆️', description: 'Tasks, docs, and goals.', operations: [{ id: 'create-task', label: 'Create task' }, { id: 'update-task', label: 'Update task' }, { id: 'search-tasks', label: 'Search tasks' }, { id: 'list-spaces', label: 'List spaces and lists' }, { id: 'create-doc', label: 'Create doc' }] },
  { id: 'monday', label: 'Monday.com', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '📅', description: 'Work OS boards, items, and workflows.', operations: [{ id: 'create-item', label: 'Create item' }, { id: 'update-item', label: 'Update item' }, { id: 'query-board', label: 'Query board' }, { id: 'change-column-value', label: 'Change column value' }, { id: 'create-update', label: 'Post update' }] },
  { id: 'trello', label: 'Trello', category: 'productivity', kind: 'mcp', auth: 'api-key', icon: '📋', description: 'Kanban boards, lists, and cards.', operations: [{ id: 'create-card', label: 'Create card' }, { id: 'update-card', label: 'Move/update card' }, { id: 'list-cards', label: 'List cards' }, { id: 'create-list', label: 'Create list' }, { id: 'add-comment', label: 'Add comment' }] },
  { id: 'google-sheets', label: 'Google Sheets', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '📗', description: 'Read and write tabular data.', operations: [{ id: 'read-range', label: 'Read range' }, { id: 'append-row', label: 'Append row' }, { id: 'update-cells', label: 'Update cells' }, { id: 'create-spreadsheet', label: 'Create spreadsheet' }, { id: 'clear-range', label: 'Clear range' }] },
  { id: 'google-docs', label: 'Google Docs', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '📄', description: 'Create and edit documents.', operations: [{ id: 'create-document', label: 'Create document' }, { id: 'get-document', label: 'Get document' }, { id: 'insert-text', label: 'Insert text' }, { id: 'replace-text', label: 'Replace text' }] },
  { id: 'microsoft-365', label: 'Microsoft 365', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '🟦', description: 'Word, Excel, OneDrive via Microsoft Graph.', operations: [{ id: 'list-files', label: 'List OneDrive files' }, { id: 'read-workbook', label: 'Read Excel workbook' }, { id: 'update-workbook', label: 'Update Excel workbook' }, { id: 'create-document', label: 'Create Word document' }, { id: 'search-files', label: 'Search files' }] },
  { id: 'coda', label: 'Coda', category: 'productivity', kind: 'mcp', auth: 'api-key', icon: '🧷', description: 'Docs, tables, and apps.', operations: [{ id: 'list-docs', label: 'List docs' }, { id: 'get-rows', label: 'Get table rows' }, { id: 'insert-row', label: 'Insert row' }, { id: 'update-row', label: 'Update row' }] },
  { id: 'todoist', label: 'Todoist', category: 'productivity', kind: 'mcp', auth: 'oauth', icon: '✅', description: 'Personal and team task manager.', operations: [{ id: 'create-task', label: 'Create task' }, { id: 'complete-task', label: 'Complete task' }, { id: 'list-tasks', label: 'List tasks' }, { id: 'list-projects', label: 'List projects' }] },

  // ── Communication ────────────────────────────────────────────────────────
  { id: 'slack', label: 'Slack', category: 'comms', kind: 'mcp', auth: 'oauth', icon: '💬', description: 'Messages, channels, search, and reactions.', operations: [{ id: 'send-message', label: 'Send message' }, { id: 'post-to-channel', label: 'Post to channel' }, { id: 'list-channels', label: 'List channels' }, { id: 'search-messages', label: 'Search messages' }, { id: 'get-channel-history', label: 'Get channel history' }, { id: 'add-reaction', label: 'Add reaction' }] },
  { id: 'discord', label: 'Discord', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '🎮', description: 'Channel messages and guild management via bot token.', operations: [{ id: 'send-message', label: 'Send message' }, { id: 'send-dm', label: 'Send direct message' }, { id: 'list-channels', label: 'List channels' }, { id: 'create-webhook-post', label: 'Post via webhook' }] },
  { id: 'microsoft-teams', label: 'Microsoft Teams', category: 'comms', kind: 'mcp', auth: 'oauth', icon: '👥', description: 'Post messages and read channels via Graph.', operations: [{ id: 'send-message', label: 'Send message' }, { id: 'post-to-channel', label: 'Post to channel' }, { id: 'list-teams', label: 'List teams' }, { id: 'list-channels', label: 'List channels' }] },
  { id: 'twilio-sms', label: 'Twilio SMS', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '📱', description: 'Programmable SMS and voice.', operations: [{ id: 'send-sms', label: 'Send SMS' }, { id: 'send-mms', label: 'Send MMS' }, { id: 'make-call', label: 'Make phone call' }, { id: 'lookup-number', label: 'Lookup phone number' }] },
  { id: 'sendgrid', label: 'SendGrid', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '📧', description: 'Transactional and marketing email.', operations: [{ id: 'send-email', label: 'Send email' }, { id: 'create-contact', label: 'Create contact' }, { id: 'manage-list', label: 'Manage contact list' }, { id: 'get-stats', label: 'Get delivery stats' }] },
  { id: 'resend', label: 'Resend', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '✉️', description: 'Developer-first transactional email.', operations: [{ id: 'send-email', label: 'Send email' }, { id: 'send-batch', label: 'Send batch emails' }, { id: 'add-contact', label: 'Add audience contact' }, { id: 'manage-domain', label: 'Manage sending domain' }] },
  { id: 'telegram', label: 'Telegram', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '✈️', description: 'Bot API messaging and chat management.', operations: [{ id: 'send-message', label: 'Send message' }, { id: 'send-photo', label: 'Send photo' }, { id: 'get-updates', label: 'Get chat updates' }, { id: 'edit-message', label: 'Edit message' }] },
  { id: 'whatsapp', label: 'WhatsApp', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '🟩', description: 'WhatsApp Business messaging via the Cloud API.', operations: [{ id: 'send-message', label: 'Send message' }, { id: 'send-template', label: 'Send template message' }, { id: 'send-media', label: 'Send media' }, { id: 'list-conversations', label: 'List conversations' }] },
  { id: 'gmail', label: 'Gmail', category: 'comms', kind: 'mcp', auth: 'oauth', icon: '📨', description: 'Send, search, and read messages.', operations: [{ id: 'send-email', label: 'Send email' }, { id: 'search-emails', label: 'Search emails' }, { id: 'read-email', label: 'Read email' }, { id: 'create-draft', label: 'Create draft' }, { id: 'add-label', label: 'Add label' }] },
  { id: 'outlook', label: 'Outlook', category: 'comms', kind: 'mcp', auth: 'oauth', icon: '📬', description: 'Microsoft 365 email via Graph.', operations: [{ id: 'send-email', label: 'Send email' }, { id: 'search-emails', label: 'Search emails' }, { id: 'read-email', label: 'Read email' }, { id: 'create-draft', label: 'Create draft' }] },
  { id: 'mailgun', label: 'Mailgun', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '🔫', description: 'Transactional email; send, validate, and track.', operations: [{ id: 'send-email', label: 'Send email' }, { id: 'validate-email', label: 'Validate email address' }, { id: 'get-events', label: 'Get delivery events' }, { id: 'manage-list', label: 'Manage mailing list' }] },
  { id: 'vonage', label: 'Vonage', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '📞', description: 'SMS, voice, and number verification.', operations: [{ id: 'send-sms', label: 'Send SMS' }, { id: 'make-call', label: 'Make voice call' }, { id: 'verify-number', label: 'Verify number' }, { id: 'send-whatsapp', label: 'Send WhatsApp message' }] },
  { id: 'postmark', label: 'Postmark', category: 'comms', kind: 'mcp', auth: 'api-key', icon: '📮', description: 'Fast transactional email with template tracking.', operations: [{ id: 'send-email', label: 'Send email' }, { id: 'send-template', label: 'Send template email' }, { id: 'get-delivery-stats', label: 'Get delivery stats' }, { id: 'get-bounces', label: 'Get bounces' }] },
  { id: 'intercom', label: 'Intercom', category: 'comms', kind: 'mcp', auth: 'oauth', icon: '🎧', description: 'Customer messaging and support.', operations: [{ id: 'send-message', label: 'Send message' }, { id: 'create-conversation', label: 'Create conversation' }, { id: 'reply-conversation', label: 'Reply to conversation' }, { id: 'search-conversations', label: 'Search conversations' }, { id: 'create-contact', label: 'Create contact' }] },

  // ── Marketing & CRM ──────────────────────────────────────────────────────
  { id: 'hubspot', label: 'HubSpot', category: 'marketing-crm', kind: 'mcp', auth: 'oauth', icon: '🟠', description: 'CRM contacts, deals, companies, and engagements.', operations: [{ id: 'create-contact', label: 'Create contact' }, { id: 'update-contact', label: 'Update contact' }, { id: 'create-deal', label: 'Create deal' }, { id: 'search-crm', label: 'Search CRM objects' }, { id: 'log-engagement', label: 'Log engagement' }] },
  { id: 'salesforce', label: 'Salesforce', category: 'marketing-crm', kind: 'mcp', auth: 'oauth', icon: '☁️', description: 'CRM records via SOQL (Agentforce MCP).', operations: [{ id: 'query-records', label: 'Query records (SOQL)' }, { id: 'create-record', label: 'Create record' }, { id: 'update-record', label: 'Update record' }, { id: 'create-lead', label: 'Create lead' }, { id: 'create-opportunity', label: 'Create opportunity' }] },
  { id: 'klaviyo', label: 'Klaviyo', category: 'marketing-crm', kind: 'mcp', auth: 'api-key', icon: '📨', description: 'Ecommerce email/SMS campaigns and flows.', operations: [{ id: 'create-campaign', label: 'Create campaign' }, { id: 'manage-profile', label: 'Manage profile' }, { id: 'manage-list', label: 'Manage list/segment' }, { id: 'get-metrics', label: 'Get metrics/reports' }, { id: 'trigger-flow', label: 'Trigger flow' }] },
  { id: 'customerio', label: 'Customer.io', category: 'marketing-crm', kind: 'mcp', auth: 'oauth', icon: '📬', description: 'Journeys and CDP campaigns and segments.', operations: [{ id: 'create-campaign', label: 'Create campaign' }, { id: 'create-segment', label: 'Create segment' }, { id: 'send-newsletter', label: 'Send newsletter' }, { id: 'get-customer', label: 'Get customer profile' }] },
  { id: 'activecampaign', label: 'ActiveCampaign', category: 'marketing-crm', kind: 'mcp', auth: 'oauth', icon: '📈', description: 'Contacts, automations, campaigns, and deals.', operations: [{ id: 'create-contact', label: 'Create contact' }, { id: 'update-contact', label: 'Update contact' }, { id: 'add-to-automation', label: 'Add to automation' }, { id: 'get-campaign', label: 'Get campaign details' }, { id: 'manage-tag', label: 'Manage tag' }] },
  { id: 'attio', label: 'Attio', category: 'marketing-crm', kind: 'mcp', auth: 'oauth', icon: '🗂️', description: 'People, companies, and deals.', operations: [{ id: 'search-records', label: 'Search records' }, { id: 'create-record', label: 'Create record' }, { id: 'update-record', label: 'Update record' }, { id: 'create-note', label: 'Create note' }, { id: 'create-task', label: 'Create task' }] },
  { id: 'zoho-crm', label: 'Zoho CRM', category: 'marketing-crm', kind: 'mcp', auth: 'oauth', icon: '🟥', description: 'CRM modules, records, and actions.', operations: [{ id: 'create-record', label: 'Create record' }, { id: 'update-record', label: 'Update record' }, { id: 'search-records', label: 'Search records' }, { id: 'convert-lead', label: 'Convert lead' }, { id: 'create-deal', label: 'Create deal' }] },
  { id: 'marketo', label: 'Adobe Marketo Engage', category: 'marketing-crm', kind: 'mcp', auth: 'oauth', icon: '🟣', description: 'Leads, smart campaigns, programs, and emails.', operations: [{ id: 'create-lead', label: 'Create lead' }, { id: 'update-lead', label: 'Update lead' }, { id: 'trigger-campaign', label: 'Trigger smart campaign' }, { id: 'manage-program', label: 'Manage program' }, { id: 'manage-list', label: 'Manage static list' }] },
  { id: 'mailchimp', label: 'Mailchimp', category: 'marketing-crm', kind: 'mcp', auth: 'api-key', icon: '🐵', description: 'Audiences, campaigns, and automations.', operations: [{ id: 'add-member', label: 'Add audience member' }, { id: 'update-member', label: 'Update audience member' }, { id: 'create-campaign', label: 'Create campaign' }, { id: 'send-campaign', label: 'Send campaign' }, { id: 'get-reports', label: 'Get reports' }] },
  { id: 'brevo', label: 'Brevo (Sendinblue)', category: 'marketing-crm', kind: 'mcp', auth: 'api-key', icon: '🟩', description: 'Contacts, lists, and email/SMS/WhatsApp campaigns.', operations: [{ id: 'create-contact', label: 'Create contact' }, { id: 'manage-list', label: 'Manage list' }, { id: 'send-transactional-email', label: 'Send transactional email' }, { id: 'create-campaign', label: 'Create email campaign' }, { id: 'track-event', label: 'Track custom event' }] },
  { id: 'pipedrive', label: 'Pipedrive', category: 'marketing-crm', kind: 'mcp', auth: 'api-key', icon: '🚀', description: 'Sales CRM for deals, leads, and pipelines.', operations: [{ id: 'create-deal', label: 'Create deal' }, { id: 'update-deal', label: 'Update deal' }, { id: 'create-person', label: 'Create person' }, { id: 'create-activity', label: 'Create activity' }, { id: 'list-pipelines', label: 'List pipelines' }] },

  // ── Analytics & data collection (marketing triggers) ─────────────────────
  { id: 'google-analytics-4', label: 'Google Analytics 4', category: 'analytics-collection', kind: 'trigger', auth: 'oauth', icon: '📈', description: 'Reports, funnels, and real-time web/app analytics.', operations: [{ id: 'run-report', label: 'Run report' }, { id: 'run-realtime-report', label: 'Run real-time report' }, { id: 'run-funnel-report', label: 'Run funnel report' }, { id: 'get-account-summaries', label: 'Get account summaries' }] },
  { id: 'posthog', label: 'PostHog', category: 'analytics-collection', kind: 'trigger', auth: 'oauth', icon: '🦔', description: 'HogQL queries, insights, flags, and events.', operations: [{ id: 'query-events', label: 'Query events' }, { id: 'run-hogql-query', label: 'Run HogQL query' }, { id: 'create-insight', label: 'Create insight' }, { id: 'manage-feature-flag', label: 'Manage feature flag' }] },
  { id: 'mixpanel', label: 'Mixpanel', category: 'analytics-collection', kind: 'trigger', auth: 'oauth', icon: '📊', description: 'Events, funnels, retention, and JQL.', operations: [{ id: 'query-events', label: 'Query events' }, { id: 'run-funnel', label: 'Run funnel report' }, { id: 'run-retention', label: 'Run retention report' }, { id: 'run-jql', label: 'Run JQL query' }] },
  { id: 'amplitude', label: 'Amplitude', category: 'analytics-collection', kind: 'trigger', auth: 'oauth', icon: '📉', description: 'Behavioral data, cohorts, and anomalies.', operations: [{ id: 'query-events', label: 'Query events' }, { id: 'build-cohort', label: 'Build cohort' }, { id: 'run-funnel', label: 'Run funnel analysis' }, { id: 'track-event', label: 'Track event' }] },
  { id: 'segment', label: 'Segment', category: 'analytics-collection', kind: 'trigger', auth: 'api-key', icon: '🔀', description: 'CDP that collects and routes customer events.', operations: [{ id: 'track-event', label: 'Track event' }, { id: 'identify-user', label: 'Identify user' }, { id: 'page-call', label: 'Page/screen call' }, { id: 'receive-webhook', label: 'Receive event webhook' }] },
  { id: 'stripe', label: 'Stripe', category: 'analytics-collection', kind: 'trigger', auth: 'api-key', icon: '💳', description: 'Payment, subscription, and invoice events.', operations: [{ id: 'payment-succeeded', label: 'Payment succeeded webhook' }, { id: 'subscription-updated', label: 'Subscription updated webhook' }, { id: 'create-customer', label: 'Create customer' }, { id: 'list-invoices', label: 'List invoices' }] },
  { id: 'statsig', label: 'Statsig', category: 'analytics-collection', kind: 'trigger', auth: 'api-key', icon: '🧪', description: 'Product analytics, experiments, and gates.', operations: [{ id: 'query-metrics', label: 'Query metrics' }, { id: 'read-experiment-results', label: 'Read experiment results' }, { id: 'check-feature-gate', label: 'Check feature gate' }, { id: 'log-event', label: 'Log event' }] },
  { id: 'fullstory', label: 'FullStory', category: 'analytics-collection', kind: 'trigger', auth: 'api-key', icon: '🎬', description: 'Session replay context and behavioral metrics.', operations: [{ id: 'query-segments', label: 'Query segments' }, { id: 'get-session-context', label: 'Get session replay context' }, { id: 'query-metrics', label: 'Query behavioral metrics' }] },
  { id: 'typeform', label: 'Typeform', category: 'analytics-collection', kind: 'trigger', auth: 'api-key', icon: '📝', description: 'Form responses delivered via webhook.', operations: [{ id: 'new-submission', label: 'New submission webhook' }, { id: 'create-webhook', label: 'Create webhook' }, { id: 'get-responses', label: 'Get responses' }] },
  { id: 'google-forms', label: 'Google Forms', category: 'analytics-collection', kind: 'trigger', auth: 'oauth', icon: '🗒️', description: 'Collect form responses; trigger on new submissions.', operations: [{ id: 'new-response', label: 'New response trigger' }, { id: 'list-responses', label: 'List responses' }, { id: 'get-form', label: 'Get form schema' }] },
  { id: 'webhook', label: 'Incoming Webhook', category: 'analytics-collection', kind: 'trigger', auth: 'none', icon: '🪝', description: 'Generic HTTP endpoint that fires on inbound requests.', operations: [{ id: 'receive-post', label: 'Receive POST payload' }, { id: 'receive-get', label: 'Receive GET request' }, { id: 'verify-signature', label: 'Verify signature' }] },
  { id: 'rss', label: 'RSS / Atom Feed', category: 'analytics-collection', kind: 'trigger', auth: 'none', icon: '📡', description: 'Poll a feed; trigger when a new item publishes.', operations: [{ id: 'new-item', label: 'New feed item trigger' }, { id: 'fetch-feed', label: 'Fetch feed' }] },
  { id: 'inbound-email', label: 'Inbound Email', category: 'analytics-collection', kind: 'trigger', auth: 'api-key', icon: '📥', description: 'Parse email to a workflow address; trigger on receipt.', operations: [{ id: 'email-received', label: 'Email received trigger' }, { id: 'parse-attachments', label: 'Parse attachments' }, { id: 'extract-body', label: 'Extract body/headers' }] },
];

export const INTEGRATION_MAP: Record<string, Integration> = INTEGRATIONS.reduce(
  (acc, i) => { acc[i.id] = i; return acc; },
  {} as Record<string, Integration>,
);

/** Build the preset config a placed integration node starts with. */
export function presetConfig(integ: Integration): Record<string, unknown> {
  const firstOp = integ.operations[0]?.id ?? '';
  switch (integ.kind) {
    case 'llm':
      return { provider: integ.id, operation: firstOp, model: '', system: '', prompt: '', temperature: 0.7 };
    case 'trigger':
      return { triggerType: 'integration', source: integ.id, operation: firstOp };
    case 'mcp':
    default:
      return { integration: integ.id, operation: firstOp, params: '{}' };
  }
}

/** Resolve the integration backing a placed node from its config, if any. */
export function integrationForConfig(config: Record<string, unknown>): Integration | undefined {
  const id = config.integration ?? config.provider ?? config.source;
  return typeof id === 'string' ? INTEGRATION_MAP[id] : undefined;
}
