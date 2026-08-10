/**
 * Tiny param DSL for the built-in connector manifests.
 *
 * A manifest is data, and data written longhand is data nobody reviews: 25 default
 * connectors × ~4 actions × ~4 params is ~400 param literals, each repeating
 * `{ type: 'string', in: 'body' }`. These helpers make the SHAPE of each action
 * readable — which values are path, which are query, which are body — so a wrong
 * location stands out instead of hiding in boilerplate.
 *
 * Used only by `defaults/`. Tenant-authored manifests arrive as JSON and go
 * through `parseConnectorManifest` instead.
 */

import type { ConnectorParam, ConnectorParamType } from '../connectorManifest';

const make = (
  type: ConnectorParamType,
  location: ConnectorParam['in'],
  description: string,
  extra: Partial<ConnectorParam> = {},
): ConnectorParam => ({ type, in: location, description, ...extra });

/** Path segment — fills a `{placeholder}` in the action path. */
export const p = (description: string, extra?: Partial<ConnectorParam>) => make('string', 'path', description, extra);
/** Query-string value. */
export const q = (description: string, extra?: Partial<ConnectorParam>) => make('string', 'query', description, extra);
/** Numeric query-string value (page sizes, limits). */
export const qn = (description: string, extra?: Partial<ConnectorParam>) => make('number', 'query', description, extra);
/** Body field. */
export const b = (description: string, extra?: Partial<ConnectorParam>) => make('string', 'body', description, extra);
/** Numeric body field. */
export const bn = (description: string, extra?: Partial<ConnectorParam>) => make('number', 'body', description, extra);
/** Boolean body field. */
export const bb = (description: string, extra?: Partial<ConnectorParam>) => make('boolean', 'body', description, extra);
/** Object body field. */
export const bo = (description: string, extra?: Partial<ConnectorParam>) => make('object', 'body', description, extra);
/** Array body field. */
export const ba = (description: string, extra?: Partial<ConnectorParam>) => make('array', 'body', description, extra);
/** Header value supplied per call (rare — most headers are static). */
export const h = (description: string, extra?: Partial<ConnectorParam>) => make('string', 'header', description, extra);
