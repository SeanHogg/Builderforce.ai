/**
 * Where an applicant mapping's board-returned values may be sent back.
 *
 * `applicants.nextToken` and `applicants.filterIdFrom` carry a value a BOARD returned into a
 * later credentialled call. A board must never choose where that call goes, so the param the
 * value fills may only be a `query` or `body` param (never `url`, which IS the request URL,
 * nor `path`), and the filter-id lookup must be a READ of this same connector.
 *
 * Needs every action parsed (the lookup names a sibling), so it runs after the action loop in
 * `parseConnectorManifest`. STRICT (a write): each fault is an error. LENIENT (a stored
 * manifest): the action's applicants mapping is disabled and the reason recorded in
 * `opts.degraded`, as for every other mapping that no longer validates.
 */

import type { ActionValidationOptions } from './connectorActionValidation';
import type { ConnectorAction } from './connectorManifest';

const WIRE_LOCATIONS: readonly string[] = ['query', 'body'];
/** Where a board-returned filter id may land (`path` is encoded by the runtime). */
const POSTING_LOCATIONS: readonly string[] = ['query', 'body', 'path'];

/** The first reason an applicant mapping would let a board steer a credentialled call, or null. */
function lookupTargetFault(action: ConnectorAction, actions: readonly ConnectorAction[]): string | null {
  const mapping = action.applicants;
  if (!mapping) return null;
  const token = mapping.nextToken;
  if (token && !WIRE_LOCATIONS.includes(action.params[token.param]?.in ?? '')) {
    return `applicants.nextToken.param "${token.param}" must be a query or body param — a token a board hands back must never choose the path or URL of a credentialled call`;
  }
  const lookup = mapping.filterIdFrom;
  if (!lookup) return null;
  // The filter id a board returns fills `postingParam`; `url` would make it the whole request URL.
  if (!POSTING_LOCATIONS.includes(action.params[mapping.postingParam]?.in ?? '')) {
    return `applicants.postingParam "${mapping.postingParam}" must be a query, body or path param when filterIdFrom is set — a filter id a board returns must never be the URL of a credentialled call`;
  }
  const sibling = actions.find((candidate) => candidate.key === lookup.action);
  if (!sibling) return `applicants.filterIdFrom.action "${lookup.action}" is not an action of this connector`;
  if (sibling.mutates) return `applicants.filterIdFrom.action "${lookup.action}" must be a read (mutates: false)`;
  if (!WIRE_LOCATIONS.includes(sibling.params[lookup.idParam]?.in ?? '')) {
    return `applicants.filterIdFrom.idParam "${lookup.idParam}" must be a query or body param of "${lookup.action}"`;
  }
  return null;
}

export function checkApplicantLookupTargets(
  actions: ConnectorAction[],
  errors: string[],
  opts: ActionValidationOptions = {},
): ConnectorAction[] {
  return actions.map((action) => {
    const fault = lookupTargetFault(action, actions);
    if (!fault) return action;
    if (!opts.lenient) { errors.push(`actions (${action.key}): ${fault}`); return action; }
    opts.degraded?.push(`actions (${action.key}): applicants mapping disabled — ${fault}`);
    const { applicants: _disabled, ...rest } = action;
    return rest;
  });
}
