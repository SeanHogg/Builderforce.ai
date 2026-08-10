/**
 * Built-in connectors — productivity, docs and spreadsheets.
 *
 * Where knowledge and lightweight records actually live for most teams. These are
 * the connectors that let an agent WRITE ITS WORK DOWN somewhere a human already
 * looks, instead of only into the platform's own tables.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, bo, p, q, qn } from './dsl';

const notion: ConnectorManifest = {
  key: 'notion',
  name: 'Notion',
  description: 'Search, read and create pages and database rows in Notion.',
  category: 'productivity',
  icon: '📓',
  baseUrl: 'https://api.notion.com/v1',
  docsUrl: 'https://developers.notion.com/reference/intro',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'Internal integration secret', secret: true, required: true, placeholder: 'ntn_…', help: 'Notion → Settings → Connections → Develop or manage integrations' }],
  },
  // Notion versions its API by header, not by URL — pin it once for every action.
  defaultHeaders: { 'Notion-Version': '2022-06-28' },
  actions: [
    {
      key: 'search', label: 'Search', description: 'Search pages and databases shared with the integration.',
      method: 'POST', path: '/search', mutates: false, resultPath: 'results',
      params: { query: b('Search text'), page_size: b('Max results (default 10)') },
    },
    {
      key: 'create_page', label: 'Create page', description: 'Create a page under a parent page or database.',
      method: 'POST', path: '/pages', mutates: true, required: ['parent_id', 'title'],
      params: {
        parent_id: b('Parent page or database id', { bodyPath: 'parent.page_id' }),
        title: b('Page title', { bodyPath: 'properties.title.title.0.text.content' }),
        children: ba('Optional block children to append on creation'),
      },
    },
    {
      key: 'query_database', label: 'Query database', description: 'Query rows in a Notion database.',
      method: 'POST', path: '/databases/{database_id}/query', mutates: false, required: ['database_id'], resultPath: 'results',
      params: { database_id: p('Database id'), filter: bo('Notion filter object'), page_size: b('Max rows') },
    },
    {
      key: 'append_blocks', label: 'Append content', description: 'Append blocks to the end of a page.',
      method: 'PATCH', path: '/blocks/{block_id}/children', mutates: true, required: ['block_id', 'children'],
      params: { block_id: p('Page or block id to append to'), children: ba('Array of Notion block objects') },
    },
  ],
};

const airtable: ConnectorManifest = {
  key: 'airtable',
  name: 'Airtable',
  description: 'Read, create and update records in an Airtable base.',
  category: 'productivity',
  icon: '🗂️',
  baseUrl: 'https://api.airtable.com/v0',
  docsUrl: 'https://airtable.com/developers/web/api/introduction',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Personal access token', secret: true, required: true, placeholder: 'pat…' }] },
  actions: [
    {
      key: 'list_records', label: 'List records', description: 'List records from a table.',
      method: 'GET', path: '/{base_id}/{table}', mutates: false, resultPath: 'records',
      required: ['base_id', 'table'],
      params: { base_id: p('Base id (app…)'), table: p('Table name or id'), maxRecords: qn('Max records'), filterByFormula: q('Airtable formula filter'), view: q('View name') },
    },
    {
      key: 'create_record', label: 'Create record', description: 'Create one record in a table.',
      method: 'POST', path: '/{base_id}/{table}', mutates: true, required: ['base_id', 'table', 'fields'],
      params: { base_id: p('Base id'), table: p('Table name or id'), fields: bo('Field map, e.g. { "Name": "Ada" }') },
    },
    {
      key: 'update_record', label: 'Update record', description: 'Patch fields on one record.',
      method: 'PATCH', path: '/{base_id}/{table}/{record_id}', mutates: true, required: ['base_id', 'table', 'record_id', 'fields'],
      params: { base_id: p('Base id'), table: p('Table name or id'), record_id: p('Record id (rec…)'), fields: bo('Field map to update') },
    },
  ],
};

const googleSheets: ConnectorManifest = {
  key: 'google-sheets',
  name: 'Google Sheets',
  description: 'Read and append rows in a Google Sheets spreadsheet.',
  category: 'productivity',
  icon: '📊',
  baseUrl: 'https://sheets.googleapis.com/v4/spreadsheets',
  docsUrl: 'https://developers.google.com/sheets/api/reference/rest',
  auth: {
    kind: 'oauth2',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    fields: [{ key: 'accessToken', label: 'OAuth access token', secret: true, required: true, help: 'A Google OAuth token with the spreadsheets scope' }],
  },
  actions: [
    {
      key: 'read_range', label: 'Read range', description: 'Read cell values from an A1 range.',
      method: 'GET', path: '/{spreadsheet_id}/values/{range}', mutates: false, required: ['spreadsheet_id', 'range'], resultPath: 'values',
      params: { spreadsheet_id: p('Spreadsheet id from the URL'), range: p("A1 range, e.g. Sheet1!A1:D50") },
    },
    {
      key: 'append_row', label: 'Append row', description: 'Append a row of values to a sheet.',
      method: 'POST', path: '/{spreadsheet_id}/values/{range}:append', mutates: true, required: ['spreadsheet_id', 'range', 'values'],
      params: {
        spreadsheet_id: p('Spreadsheet id'), range: p("Target range, e.g. Sheet1!A1"),
        values: ba('Array of row arrays, e.g. [["Ada", 42]]'),
        valueInputOption: q('RAW or USER_ENTERED', { enum: ['RAW', 'USER_ENTERED'], default: 'USER_ENTERED' }),
      },
    },
    {
      key: 'update_range', label: 'Update range', description: 'Overwrite the values in an A1 range.',
      method: 'PUT', path: '/{spreadsheet_id}/values/{range}', mutates: true, required: ['spreadsheet_id', 'range', 'values'],
      params: {
        spreadsheet_id: p('Spreadsheet id'), range: p('A1 range to overwrite'),
        values: ba('Array of row arrays'),
        valueInputOption: q('RAW or USER_ENTERED', { enum: ['RAW', 'USER_ENTERED'], default: 'USER_ENTERED' }),
      },
    },
  ],
};

const trello: ConnectorManifest = {
  key: 'trello',
  name: 'Trello',
  description: 'Create and move cards on Trello boards.',
  category: 'productivity',
  icon: '📋',
  baseUrl: 'https://api.trello.com/1',
  docsUrl: 'https://developer.atlassian.com/cloud/trello/rest/',
  auth: {
    // Trello wants BOTH key and token on the query string; the api_key mechanism
    // carries the token and the key rides as a templated query param on each action.
    kind: 'api_key', in: 'query', name: 'token',
    fields: [
      { key: 'key', label: 'API key', secret: false, required: true },
      { key: 'apiKey', label: 'API token', secret: true, required: true },
    ],
  },
  actions: [
    {
      key: 'list_boards', label: 'List boards', description: 'List the boards the token can see.',
      method: 'GET', path: '/members/me/boards', mutates: false,
      params: { key: q('Trello API key', { default: '{{auth.key}}' }), fields: q('Comma list of fields to return') },
    },
    {
      key: 'list_cards', label: 'List cards', description: 'List the cards on a board.',
      method: 'GET', path: '/boards/{board_id}/cards', mutates: false, required: ['board_id'],
      params: { board_id: p('Board id'), key: q('Trello API key', { default: '{{auth.key}}' }) },
    },
    {
      key: 'create_card', label: 'Create card', description: 'Create a card in a list.',
      method: 'POST', path: '/cards', mutates: true, required: ['idList', 'name'],
      params: {
        idList: q('Target list id'), name: q('Card title'), desc: q('Card description'), due: q('Due date (ISO 8601)'),
        key: q('Trello API key', { default: '{{auth.key}}' }),
      },
    },
    {
      key: 'move_card', label: 'Move card', description: 'Move a card to a different list.',
      method: 'PUT', path: '/cards/{card_id}', mutates: true, required: ['card_id', 'idList'],
      params: { card_id: p('Card id'), idList: q('Destination list id'), key: q('Trello API key', { default: '{{auth.key}}' }) },
    },
  ],
};

const calendly: ConnectorManifest = {
  key: 'calendly',
  name: 'Calendly',
  description: 'Read scheduled events and invitees from Calendly.',
  category: 'productivity',
  icon: '📅',
  baseUrl: 'https://api.calendly.com',
  docsUrl: 'https://developer.calendly.com/api-docs',
  auth: { kind: 'bearer', fields: [{ key: 'token', label: 'Personal access token', secret: true, required: true }] },
  actions: [
    {
      key: 'current_user', label: 'Who am I', description: 'Return the authenticated user, including their organization URI.',
      method: 'GET', path: '/users/me', mutates: false, params: {}, resultPath: 'resource',
    },
    {
      key: 'list_events', label: 'List scheduled events', description: 'List scheduled events for a user or organization.',
      method: 'GET', path: '/scheduled_events', mutates: false, resultPath: 'collection',
      params: { user: q('User URI (from Who am I)'), organization: q('Organization URI'), status: q('active | canceled'), min_start_time: q('ISO 8601 lower bound') },
    },
    {
      key: 'list_invitees', label: 'List invitees', description: 'List the invitees on a scheduled event.',
      method: 'GET', path: '/scheduled_events/{uuid}/invitees', mutates: false, required: ['uuid'], resultPath: 'collection',
      params: { uuid: p('Scheduled event UUID') },
    },
  ],
};

export const PRODUCTIVITY_CONNECTORS: readonly ConnectorManifest[] = [notion, airtable, googleSheets, trello, calendly];
