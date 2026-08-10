/**
 * The generic HTTP connector — the escape hatch.
 *
 * Every catalog is missing the API someone needs today. Rather than making that
 * person wait for a connector to be authored, this one turns any HTTPS base URL
 * into four actions with an arbitrary path. It is the same role Make's HTTP module
 * and Zapier's Webhooks step play, and it means the honest answer to "do you
 * support X?" is always yes.
 *
 * It is NOT a hole in the trust boundary: the resolved URL goes through the same
 * SSRF guard (literal check + DNS re-resolution) as every other connector call, so
 * it can no more reach the metadata endpoint or an internal host than Slack can.
 */

import type { ConnectorManifest } from '../connectorManifest';
import type { ConnectorParam } from '../connectorManifest';
import { p } from './dsl';

const pathParam = p('Path appended to the base URL, e.g. /v1/widgets/42');
/** Object-typed query param — the runtime SPREADS its keys onto the query string. */
const queryParam: ConnectorParam = { type: 'object', in: 'query', description: 'Query parameters, e.g. { "limit": 10, "sort": "desc" }' };
/** `bodyPath: '$'` makes this value the ENTIRE request body rather than one field of it. */
const bodyParam: ConnectorParam = { type: 'object', in: 'body', bodyPath: '$', description: 'JSON request body' };

const http: ConnectorManifest = {
  key: 'http',
  name: 'HTTP Request',
  description: 'Call any HTTPS API by URL — the escape hatch for systems without a dedicated connector.',
  category: 'other',
  icon: '🌐',
  baseUrl: '{{auth.baseUrl}}',
  auth: {
    // A single optional header carries whatever the target expects — `Bearer x`,
    // `Token x`, an API key, or nothing at all for a public endpoint.
    kind: 'api_key',
    in: 'header',
    name: 'Authorization',
    fields: [
      { key: 'baseUrl', label: 'Base URL', secret: false, required: true, placeholder: 'https://api.example.com', help: 'HTTPS only. Paths are appended to this.' },
      { key: 'apiKey', label: 'Authorization header value', secret: true, required: false, placeholder: 'Bearer sk-…', help: 'Sent as the Authorization header. Leave blank for public APIs.' },
    ],
  },
  actions: [
    {
      key: 'get', label: 'GET', description: 'Send a GET request and return the JSON response.',
      method: 'GET', path: '/{path}', mutates: false, required: ['path'],
      params: { path: pathParam, query: queryParam },
    },
    {
      key: 'post', label: 'POST', description: 'Send a POST request with a JSON body.',
      method: 'POST', path: '/{path}', mutates: true, required: ['path'],
      params: { path: pathParam, query: queryParam, body: bodyParam },
    },
    {
      key: 'put', label: 'PUT', description: 'Send a PUT request with a JSON body.',
      method: 'PUT', path: '/{path}', mutates: true, required: ['path'],
      params: { path: pathParam, query: queryParam, body: bodyParam },
    },
    {
      key: 'delete', label: 'DELETE', description: 'Send a DELETE request.',
      method: 'DELETE', path: '/{path}', mutates: true, required: ['path'],
      params: { path: pathParam, query: queryParam },
    },
  ],
};

export const GENERIC_CONNECTORS: readonly ConnectorManifest[] = [http];
