/**
 * Built-in connectors — the whiteboards a team is migrating OFF.
 *
 * Its own category-shaped file rather than another entry in `productivity.ts`
 * because these connectors are read for one reason the others are not: a person
 * connecting Miro here is almost always doing it once, to bring their boards
 * across, and then never thinking about it again. The actions are shaped for that
 * — list what I have, read one whole — rather than for an agent that will be
 * writing to the board every day.
 *
 * ── WHY A PERSONAL TOKEN AND NOT OAUTH ───────────────────────────────────────
 * Miro issues every user a token from their own developer app in about a minute,
 * and it needs no client secret held by this platform. That matters more than the
 * usual OAuth-is-nicer argument: an OAuth connector cannot be used at all until
 * someone registers a Builderforce app with Miro and puts the client id and secret
 * in this deployment's secrets, so shipping OAuth-first would ship a connector
 * nobody could connect. `auth.kind: 'bearer'` is the same shape Notion and
 * Airtable use here, for the same reason.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
 * There is no action here that reads Miroverse. The 7,000 community templates are
 * third-party creators' work published under Miro's Online Community Terms, which
 * license reuse inside Miro — a bulk import of that library into a competing
 * canvas is an IP problem, not a feature. What a person may do, and what
 * `list_boards` sees, is a Miroverse template they have already copied into their
 * own account. The consent boundary is the account, and it is the customer's to
 * cross, not ours.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { p, q, qn } from './dsl';

const miro: ConnectorManifest = {
  key: 'miro',
  name: 'Miro',
  description: 'Read your Miro boards and their items, so a board can be brought onto the canvas.',
  category: 'productivity',
  icon: '🟨',
  baseUrl: 'https://api.miro.com/v2',
  docsUrl: 'https://developers.miro.com/reference/api-reference',
  auth: {
    kind: 'bearer',
    fields: [{
      key: 'token',
      label: 'Miro access token',
      secret: true,
      required: true,
      placeholder: 'eyJtaXJvLm9yaWdpbnMi…',
      help: 'Miro → your profile → Settings → Your apps → create an app → Install and get OAuth token. Read-only board scopes are enough.',
    }],
  },
  actions: [
    {
      key: 'list_boards',
      label: 'List boards',
      description: 'List the Miro boards this token can read, newest first. Includes any Miroverse template already copied into the account.',
      method: 'GET', path: '/boards', mutates: false, resultPath: 'data',
      params: {
        // Miro's own maximum is 50; asking for more is a 400 rather than a clamp.
        limit: qn('Boards per page, 1–50'),
        offset: qn('Row offset for the next page'),
        query: q('Filter by board name'),
        team_id: q('Restrict to one Miro team'),
        sort: q('default | last_modified | last_opened | last_created | alphabetically'),
      },
    },
    {
      key: 'get_board',
      label: 'Get board',
      description: 'Read one board’s name, description and policy.',
      method: 'GET', path: '/boards/{board_id}', mutates: false, required: ['board_id'],
      params: { board_id: p('Board id, as returned by list_boards') },
    },
    {
      key: 'get_items',
      label: 'Get board items',
      description: 'Read a page of items on a board — sticky notes, text, shapes, cards, frames, images, documents and embeds.',
      method: 'GET', path: '/boards/{board_id}/items', mutates: false, required: ['board_id'], resultPath: 'data',
      params: {
        board_id: p('Board id'),
        // Cursor-based, not offset-based: a large board is walked, and passing the
        // previous response's `cursor` is the only way to reach page two.
        limit: qn('Items per page, 1–50'),
        cursor: q('Cursor from the previous page’s response'),
        type: q('Restrict to one item type, e.g. sticky_note'),
      },
    },
    {
      key: 'get_connectors',
      label: 'Get board connectors',
      description: 'Read the lines drawn between items. A separate endpoint from items, so a faithful import reads both.',
      method: 'GET', path: '/boards/{board_id}/connectors', mutates: false, required: ['board_id'], resultPath: 'data',
      params: { board_id: p('Board id'), limit: qn('Connectors per page, 1–50'), cursor: q('Cursor from the previous page’s response') },
    },
  ],
};

export const WHITEBOARD_CONNECTORS: readonly ConnectorManifest[] = [miro];
