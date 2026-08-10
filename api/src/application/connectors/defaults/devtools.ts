/**
 * Built-in connectors — developer and delivery tooling.
 *
 * Overlap with `boardsync/providerCatalog` is deliberate and not duplication: the
 * board adapters SYNC work items into the kanban (a modelled, two-way mapping),
 * while these expose the rest of each product's API as one-shot agent actions —
 * dispatch a workflow, purge a cache, resolve a Sentry issue. Different jobs,
 * different contracts; a connector never writes to the tasks table.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, bo, p, q, qn } from './dsl';

const github: ConnectorManifest = {
  key: 'github',
  name: 'GitHub',
  description: 'Open issues, comment on pull requests and dispatch workflows on GitHub.',
  category: 'devtools',
  icon: '🐙',
  baseUrl: 'https://api.github.com',
  docsUrl: 'https://docs.github.com/en/rest',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Personal access token', secret: true, required: true, placeholder: 'ghp_… or github_pat_…' }] },
  defaultHeaders: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  actions: [
    {
      key: 'create_issue', label: 'Create issue', description: 'Open an issue on a repository.',
      method: 'POST', path: '/repos/{owner}/{repo}/issues', mutates: true, required: ['owner', 'repo', 'title'],
      params: { owner: p('Repository owner'), repo: p('Repository name'), title: b('Issue title'), body: b('Issue body (Markdown)'), labels: ba('Label names'), assignees: ba('GitHub usernames') },
    },
    {
      key: 'list_pull_requests', label: 'List pull requests', description: 'List pull requests on a repository.',
      method: 'GET', path: '/repos/{owner}/{repo}/pulls', mutates: false, required: ['owner', 'repo'],
      params: { owner: p('Repository owner'), repo: p('Repository name'), state: q('open | closed | all', { enum: ['open', 'closed', 'all'] }), per_page: qn('Results per page') },
    },
    {
      key: 'comment_on_issue', label: 'Comment on issue or PR', description: 'Add a comment to an issue or pull request.',
      method: 'POST', path: '/repos/{owner}/{repo}/issues/{number}/comments', mutates: true, required: ['owner', 'repo', 'number', 'body'],
      params: { owner: p('Repository owner'), repo: p('Repository name'), number: p('Issue or PR number'), body: b('Comment body (Markdown)') },
    },
    {
      key: 'dispatch_workflow', label: 'Run a workflow', description: 'Trigger a workflow_dispatch GitHub Action run.',
      method: 'POST', path: '/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', mutates: true,
      required: ['owner', 'repo', 'workflow_id', 'ref'],
      params: { owner: p('Repository owner'), repo: p('Repository name'), workflow_id: p('Workflow file name, e.g. ci.yml'), ref: b('Branch or tag to run against'), inputs: bo('Workflow inputs') },
    },
    {
      key: 'search_code', label: 'Search code', description: 'Search code across repositories.',
      method: 'GET', path: '/search/code', mutates: false, required: ['q'], resultPath: 'items',
      params: { q: q('GitHub code-search query, e.g. addClass repo:acme/web'), per_page: qn('Results per page') },
    },
  ],
};

const gitlab: ConnectorManifest = {
  key: 'gitlab',
  name: 'GitLab',
  description: 'Open issues, review merge requests and trigger pipelines on GitLab.',
  category: 'devtools',
  icon: '🦊',
  baseUrl: 'https://gitlab.com/api/v4',
  docsUrl: 'https://docs.gitlab.com/ee/api/rest/',
  auth: {
    kind: 'api_key', in: 'header', name: 'PRIVATE-TOKEN',
    fields: [{ key: 'apiKey', label: 'Personal access token', secret: true, required: true, placeholder: 'glpat-…' }],
  },
  actions: [
    {
      key: 'create_issue', label: 'Create issue', description: 'Open an issue on a project.',
      method: 'POST', path: '/projects/{id}/issues', mutates: true, required: ['id', 'title'],
      params: { id: p('Project id or URL-encoded path (group%2Frepo)'), title: b('Issue title'), description: b('Issue description'), labels: b('Comma-separated labels') },
    },
    {
      key: 'list_merge_requests', label: 'List merge requests', description: 'List merge requests on a project.',
      method: 'GET', path: '/projects/{id}/merge_requests', mutates: false, required: ['id'],
      params: { id: p('Project id or URL-encoded path'), state: q('opened | closed | merged | all'), per_page: qn('Results per page') },
    },
    {
      key: 'trigger_pipeline', label: 'Trigger pipeline', description: 'Start a CI pipeline on a ref.',
      method: 'POST', path: '/projects/{id}/pipeline', mutates: true, required: ['id', 'ref'],
      params: { id: p('Project id or URL-encoded path'), ref: q('Branch or tag') },
    },
  ],
};

const linear: ConnectorManifest = {
  key: 'linear',
  name: 'Linear',
  description: 'Create and search Linear issues through the GraphQL API.',
  category: 'devtools',
  icon: '📐',
  baseUrl: 'https://api.linear.app',
  docsUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api',
  auth: {
    // Linear takes the raw key in Authorization with no Bearer prefix.
    kind: 'api_key', in: 'header', name: 'Authorization',
    fields: [{ key: 'apiKey', label: 'Personal API key', secret: true, required: true, placeholder: 'lin_api_…' }],
  },
  actions: [
    {
      key: 'run_query', label: 'Run GraphQL query', description: 'Run any Linear GraphQL query or mutation.',
      method: 'POST', path: '/graphql', mutates: true, required: ['query'], resultPath: 'data',
      params: { query: b('GraphQL document'), variables: bo('Query variables') },
    },
    {
      key: 'list_issues', label: 'List issues', description: 'List recent issues with their state and assignee.',
      method: 'POST', path: '/graphql', mutates: false, resultPath: 'data.issues.nodes',
      params: { variables: bo('Optional { first: 25 }') },
      bodyTemplate: {
        query: 'query Issues($first: Int = 25) { issues(first: $first) { nodes { id identifier title state { name } assignee { name } url } } }',
      },
    },
  ],
};

const jira: ConnectorManifest = {
  key: 'jira',
  name: 'Jira',
  description: 'Create issues, run JQL searches and comment in Jira Cloud.',
  category: 'devtools',
  icon: '🔷',
  baseUrl: 'https://{{auth.site}}.atlassian.net/rest/api/3',
  docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'site', label: 'Site', secret: false, required: true, placeholder: 'acme', help: 'The acme in acme.atlassian.net' },
      { key: 'username', label: 'Atlassian account email', secret: false, required: true },
      { key: 'password', label: 'API token', secret: true, required: true, help: 'id.atlassian.com → Security → API tokens' },
    ],
  },
  actions: [
    {
      key: 'search', label: 'Search issues (JQL)', description: 'Run a JQL search and return matching issues.',
      method: 'GET', path: '/search', mutates: false, required: ['jql'], resultPath: 'issues',
      params: { jql: q('JQL, e.g. project = ENG AND status = "In Progress"'), maxResults: qn('Max results'), fields: q('Comma list of fields to return') },
    },
    {
      key: 'create_issue', label: 'Create issue', description: 'Create an issue in a project.',
      method: 'POST', path: '/issue', mutates: true, required: ['project_key', 'summary', 'issue_type'],
      params: {
        project_key: b('Project key, e.g. ENG', { bodyPath: 'fields.project.key' }),
        summary: b('Issue summary', { bodyPath: 'fields.summary' }),
        issue_type: b('Issue type name, e.g. Task or Bug', { bodyPath: 'fields.issuetype.name' }),
        description: b('Plain-text description', { bodyPath: 'fields.description.content.0.content.0.text' }),
      },
      bodyTemplate: { fields: { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] } } },
    },
    {
      key: 'add_comment', label: 'Add comment', description: 'Comment on an issue.',
      method: 'POST', path: '/issue/{key}/comment', mutates: true, required: ['key', 'text'],
      params: { key: p('Issue key, e.g. ENG-42'), text: b('Comment text', { bodyPath: 'body.content.0.content.0.text' }) },
      bodyTemplate: { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] } },
    },
  ],
};

const sentry: ConnectorManifest = {
  key: 'sentry',
  name: 'Sentry',
  description: 'Triage Sentry issues — list, inspect and resolve.',
  category: 'devtools',
  icon: '🚨',
  baseUrl: 'https://sentry.io/api/0',
  docsUrl: 'https://docs.sentry.io/api/',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Auth token', secret: true, required: true, placeholder: 'sntrys_…' }] },
  actions: [
    {
      key: 'list_issues', label: 'List issues', description: 'List unresolved issues in a project.',
      method: 'GET', path: '/projects/{org}/{project}/issues/', mutates: false, required: ['org', 'project'],
      params: { org: p('Organization slug'), project: p('Project slug'), query: q('Sentry search, e.g. is:unresolved'), statsPeriod: q('e.g. 24h or 14d') },
    },
    {
      key: 'get_issue', label: 'Get issue', description: 'Fetch one issue with its metadata and counts.',
      method: 'GET', path: '/issues/{issue_id}/', mutates: false, required: ['issue_id'],
      params: { issue_id: p('Sentry issue id') },
    },
    {
      key: 'resolve_issue', label: 'Resolve issue', description: 'Mark an issue resolved, ignored, or unresolved.',
      method: 'PUT', path: '/issues/{issue_id}/', mutates: true, required: ['issue_id', 'status'],
      params: { issue_id: p('Sentry issue id'), status: b('resolved | ignored | unresolved', { enum: ['resolved', 'ignored', 'unresolved'] }) },
    },
  ],
};

const vercel: ConnectorManifest = {
  key: 'vercel',
  name: 'Vercel',
  description: 'Inspect Vercel projects and deployments.',
  category: 'devtools',
  icon: '▲',
  baseUrl: 'https://api.vercel.com',
  docsUrl: 'https://vercel.com/docs/rest-api',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Access token', secret: true, required: true }] },
  actions: [
    {
      key: 'list_projects', label: 'List projects', description: 'List projects in the account or team.',
      method: 'GET', path: '/v9/projects', mutates: false, resultPath: 'projects',
      params: { teamId: q('Team id (omit for personal account)'), limit: qn('Max results') },
    },
    {
      key: 'list_deployments', label: 'List deployments', description: 'List recent deployments and their state.',
      method: 'GET', path: '/v6/deployments', mutates: false, resultPath: 'deployments',
      params: { projectId: q('Filter by project id'), teamId: q('Team id'), limit: qn('Max results'), state: q('BUILDING | ERROR | READY | CANCELED') },
    },
    {
      key: 'get_deployment', label: 'Get deployment', description: 'Fetch one deployment, including its build state.',
      method: 'GET', path: '/v13/deployments/{id}', mutates: false, required: ['id'],
      params: { id: p('Deployment id or URL'), teamId: q('Team id') },
    },
  ],
};

const cloudflare: ConnectorManifest = {
  key: 'cloudflare',
  name: 'Cloudflare',
  description: 'Manage zones, DNS records and cache on Cloudflare.',
  category: 'devtools',
  icon: '🟠',
  baseUrl: 'https://api.cloudflare.com/client/v4',
  docsUrl: 'https://developers.cloudflare.com/api/',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'API token', secret: true, required: true, help: 'Cloudflare → My Profile → API Tokens' }] },
  actions: [
    {
      key: 'list_zones', label: 'List zones', description: 'List the zones the token can see.',
      method: 'GET', path: '/zones', mutates: false, resultPath: 'result',
      params: { name: q('Filter by zone name'), per_page: qn('Results per page') },
    },
    {
      key: 'purge_cache', label: 'Purge cache', description: 'Purge the edge cache for a zone.',
      method: 'POST', path: '/zones/{zone_id}/purge_cache', mutates: true, required: ['zone_id'],
      params: { zone_id: p('Zone id'), files: ba('Specific URLs to purge'), purge_everything: b('Set true to purge the whole zone', { enum: ['true', 'false'] }) },
    },
    {
      key: 'list_dns_records', label: 'List DNS records', description: 'List DNS records in a zone.',
      method: 'GET', path: '/zones/{zone_id}/dns_records', mutates: false, required: ['zone_id'], resultPath: 'result',
      params: { zone_id: p('Zone id'), type: q('Record type, e.g. A or CNAME'), name: q('Filter by record name') },
    },
  ],
};

export const DEVTOOLS_CONNECTORS: readonly ConnectorManifest[] = [github, gitlab, linear, jira, sentry, vercel, cloudflare];
