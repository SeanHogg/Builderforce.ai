/**
 * Built-in connectors — clouds the customer's app actually runs on, plus the
 * Postgres they own (not the platform database).
 *
 * Cloudflare, GCP, Azure, AWS and Vercel ship in `devtools.ts` (recategorised
 * to `cloud`). This file is everything that was missing from that set: Neon,
 * and the PaaS hosts a customer-app preview commonly deploys to.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, p, q } from './dsl';

const neon: ConnectorManifest = {
  key: 'neon',
  name: 'Neon',
  description: 'List Neon projects, branches and connection URIs — the Postgres a tenant owns, not the platform database.',
  category: 'cloud',
  icon: '🟢',
  baseUrl: 'https://console.neon.tech/api/v2',
  docsUrl: 'https://api-docs.neon.tech/reference/getting-started-with-neon-api',
  auth: {
    kind: 'bearer',
    fields: [{
      key: 'token',
      label: 'API key',
      secret: true,
      required: true,
      help: 'Neon console → Account settings → API keys',
    }],
  },
  actions: [
    {
      key: 'list_projects',
      label: 'List projects',
      description: 'List Neon projects the API key can see.',
      method: 'GET',
      path: '/projects',
      mutates: false,
      resultPath: 'projects',
      params: {},
    },
    {
      key: 'get_project',
      label: 'Get project',
      description: 'Fetch one Neon project, including its region and defaults.',
      method: 'GET',
      path: '/projects/{project_id}',
      mutates: false,
      required: ['project_id'],
      params: { project_id: p('Neon project id') },
    },
    {
      key: 'list_branches',
      label: 'List branches',
      description: 'List branches in a Neon project.',
      method: 'GET',
      path: '/projects/{project_id}/branches',
      mutates: false,
      required: ['project_id'],
      resultPath: 'branches',
      params: { project_id: p('Neon project id') },
    },
    {
      key: 'get_connection_uri',
      label: 'Get connection URI',
      description: 'Return a Postgres connection URI for a role and database.',
      method: 'GET',
      path: '/projects/{project_id}/connection_uri',
      mutates: false,
      required: ['project_id', 'database_name', 'role_name'],
      params: {
        project_id: p('Neon project id'),
        database_name: q('Database name'),
        role_name: q('Role name'),
      },
    },
    {
      key: 'create_project',
      label: 'Create project',
      description: 'Create a Neon project in a region.',
      method: 'POST',
      path: '/projects',
      mutates: true,
      required: ['name'],
      params: {
        name: b('Project name'),
        region_id: b('Region id, e.g. aws-us-east-1'),
      },
    },
  ],
};

const netlify: ConnectorManifest = {
  key: 'netlify',
  name: 'Netlify',
  description: 'List Netlify sites and deploys — the Jamstack host a customer app lands on.',
  category: 'cloud',
  icon: '🟢',
  baseUrl: 'https://api.netlify.com/api/v1',
  docsUrl: 'https://docs.netlify.com/api/get-started/',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Personal access token', secret: true, required: true }] },
  actions: [
    {
      key: 'list_sites', label: 'List sites', description: 'List sites the token can see.',
      method: 'GET', path: '/sites', mutates: false, params: {},
    },
    {
      key: 'get_site', label: 'Get site', description: 'Fetch one Netlify site.',
      method: 'GET', path: '/sites/{site_id}', mutates: false, required: ['site_id'],
      params: { site_id: p('Site id') },
    },
    {
      key: 'list_deploys', label: 'List deploys', description: 'List deploys for a site.',
      method: 'GET', path: '/sites/{site_id}/deploys', mutates: false, required: ['site_id'],
      params: { site_id: p('Site id') },
    },
  ],
};

const fly: ConnectorManifest = {
  key: 'fly',
  name: 'Fly.io',
  description: 'List Fly.io apps and machines — the edge host a customer app lands on.',
  category: 'cloud',
  icon: '🪰',
  baseUrl: 'https://api.machines.dev/v1',
  docsUrl: 'https://fly.io/docs/machines/api/',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'API token', secret: true, required: true, help: 'fly tokens create' }] },
  actions: [
    {
      key: 'list_apps', label: 'List apps', description: 'List Fly apps the token can see.',
      method: 'GET', path: '/apps', mutates: false, params: {},
    },
    {
      key: 'get_app', label: 'Get app', description: 'Fetch one Fly app.',
      method: 'GET', path: '/apps/{app_name}', mutates: false, required: ['app_name'],
      params: { app_name: p('App name') },
    },
    {
      key: 'list_machines', label: 'List machines', description: 'List machines in a Fly app.',
      method: 'GET', path: '/apps/{app_name}/machines', mutates: false, required: ['app_name'],
      params: { app_name: p('App name') },
    },
  ],
};

const render: ConnectorManifest = {
  key: 'render',
  name: 'Render',
  description: 'List Render services and deploys — the PaaS a customer app lands on.',
  category: 'cloud',
  icon: '🟪',
  baseUrl: 'https://api.render.com/v1',
  docsUrl: 'https://api-docs.render.com/',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'API key', secret: true, required: true }] },
  actions: [
    {
      key: 'list_services', label: 'List services', description: 'List Render services the token can see.',
      method: 'GET', path: '/services', mutates: false, params: {},
    },
    {
      key: 'get_service', label: 'Get service', description: 'Fetch one Render service.',
      method: 'GET', path: '/services/{service_id}', mutates: false, required: ['service_id'],
      params: { service_id: p('Service id') },
    },
    {
      key: 'list_deploys', label: 'List deploys', description: 'List deploys for a service.',
      method: 'GET', path: '/services/{service_id}/deploys', mutates: false, required: ['service_id'],
      params: { service_id: p('Service id') },
    },
  ],
};

const digitalocean: ConnectorManifest = {
  key: 'digitalocean',
  name: 'DigitalOcean',
  description: 'List DigitalOcean App Platform apps — the PaaS a customer app lands on.',
  category: 'cloud',
  icon: '🌊',
  baseUrl: 'https://api.digitalocean.com/v2',
  docsUrl: 'https://docs.digitalocean.com/reference/api/api-reference/',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'API token', secret: true, required: true }] },
  actions: [
    {
      key: 'list_apps', label: 'List apps', description: 'List App Platform apps the token can see.',
      method: 'GET', path: '/apps', mutates: false, resultPath: 'apps', params: {},
    },
    {
      key: 'get_app', label: 'Get app', description: 'Fetch one App Platform app.',
      method: 'GET', path: '/apps/{app_id}', mutates: false, required: ['app_id'],
      params: { app_id: p('App id') },
    },
    {
      key: 'list_deployments', label: 'List deployments', description: 'List deployments for an app.',
      method: 'GET', path: '/apps/{app_id}/deployments', mutates: false, required: ['app_id'], resultPath: 'deployments',
      params: { app_id: p('App id') },
    },
  ],
};

const heroku: ConnectorManifest = {
  key: 'heroku',
  name: 'Heroku',
  description: 'List Heroku apps and releases — the PaaS a customer app lands on.',
  category: 'cloud',
  icon: '🟪',
  baseUrl: 'https://api.heroku.com',
  docsUrl: 'https://devcenter.heroku.com/articles/platform-api-reference',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'API token', secret: true, required: true, help: 'heroku auth:token' }] },
  actions: [
    {
      key: 'list_apps', label: 'List apps', description: 'List Heroku apps the token can see.',
      method: 'GET', path: '/apps', mutates: false, params: {},
    },
    {
      key: 'get_app', label: 'Get app', description: 'Fetch one Heroku app.',
      method: 'GET', path: '/apps/{app_id}', mutates: false, required: ['app_id'],
      params: { app_id: p('App id or name') },
    },
    {
      key: 'list_releases', label: 'List releases', description: 'List releases for an app.',
      method: 'GET', path: '/apps/{app_id}/releases', mutates: false, required: ['app_id'],
      params: { app_id: p('App id or name') },
    },
  ],
};

const supabase: ConnectorManifest = {
  key: 'supabase',
  name: 'Supabase',
  description: 'List Supabase projects — the Postgres a tenant owns, not the platform database.',
  category: 'cloud',
  icon: '🟩',
  baseUrl: 'https://api.supabase.com/v1',
  docsUrl: 'https://supabase.com/docs/reference/api/introduction',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Access token', secret: true, required: true, help: 'Supabase dashboard → Account → Access Tokens' }] },
  actions: [
    {
      key: 'list_projects', label: 'List projects', description: 'List Supabase projects the token can see.',
      method: 'GET', path: '/projects', mutates: false, params: {},
    },
    {
      key: 'get_project', label: 'Get project', description: 'Fetch one Supabase project.',
      method: 'GET', path: '/projects/{ref}', mutates: false, required: ['ref'],
      params: { ref: p('Project ref') },
    },
    {
      key: 'list_secrets', label: 'List secrets', description: 'List secrets for a project.',
      method: 'GET', path: '/projects/{ref}/secrets', mutates: false, required: ['ref'],
      params: { ref: p('Project ref') },
    },
  ],
};

export const CLOUD_CONNECTORS: readonly ConnectorManifest[] = [
  neon, netlify, fly, render, digitalocean, heroku, supabase,
];
