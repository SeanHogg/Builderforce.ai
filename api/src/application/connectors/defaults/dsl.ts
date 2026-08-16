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

import type { ConnectorAuthField, ConnectorParam, ConnectorParamType } from '../connectorManifest';

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

/**
 * THE credential pair every Twilio REST product takes.
 *
 * ── WHY THIS IS A PRIMITIVE AND NOT FIVE LITERALS ────────────────────────────
 * `twilio`, `twilio-verify`, `twilio-lookup`, `twilio-conversations` and
 * `twilio-assistants` are five manifests because they are five API hosts — but
 * they authenticate identically, so the credential pair was written out five
 * times. Four copies said the password may be an API key secret; the fifth —
 * `twilio`, the SMS/voice connector nearly everyone connects first — said only
 * "Auth token". An operator following Twilio's own recommendation put an API key
 * SID in the username field, read "Auth token" underneath it, pasted their Auth
 * Token, and got a 401 on every send with nothing on the form to explain it.
 *
 * One definition is what stops the most-used copy being the one that drifts.
 *
 * ── WHY THE API KEY IS NAMED FIRST ───────────────────────────────────────────
 * Twilio recommends an API key (`SK…`) over the Account SID + Auth Token pair,
 * because a key can be revoked and rotated on its own while the Auth Token is
 * account-wide and rotating it breaks everything at once. Both still work — this
 * is HTTP Basic either way — so the labels offer both and lead with the one
 * Twilio tells you to use.
 *
 * ── THE TRAP THE `help` TEXT EXISTS FOR ──────────────────────────────────────
 * The two fields must come from the SAME credential: an `SK…` pairs with its own
 * secret, an `AC…` pairs with the Auth Token. Half of each is the single most
 * common 401 here, and the form is the only place that can say so in time.
 *
 * NOTE for anyone extending this: inbound webhook signatures are a DIFFERENT
 * credential. Twilio signs `X-Twilio-Signature` with the Auth Token and offers no
 * API-key equivalent, so `TWILIO_AUTH_TOKEN` in a project's secret vault must stay
 * the Auth Token even when sending goes through an API key. See
 * `realization/targets/phoneLine.ts`.
 */
export const TWILIO_REST_CREDENTIALS: readonly ConnectorAuthField[] = [
  {
    key: 'username',
    label: 'API key SID (or Account SID)',
    secret: false,
    required: true,
    placeholder: 'SK… or AC…',
    help: 'Twilio recommends an API key: Console → Account → API keys & tokens → Create API key. A key can be revoked on its own; the Auth Token cannot.',
  },
  {
    key: 'password',
    label: 'API key secret (or Auth token)',
    secret: true,
    required: true,
    help: 'Must be the partner of the field above — an API key SID pairs with its secret, an Account SID pairs with the Auth Token. Mixing the two is the usual cause of a 401.',
  },
];

/**
 * The account a Twilio request is made AGAINST, for the one manifest whose base
 * URL addresses it (`/2010-04-01/Accounts/{{auth.accountSid}}`).
 *
 * Separate from the credential pair because it answers a different question:
 * `username` is WHO IS CALLING and this is WHOSE ACCOUNT. They are the same
 * string only when you authenticate with the Account SID, which is exactly why
 * people using an API key put the `SK…` here and get a 404 on a URL that no
 * longer names a real account.
 */
export const TWILIO_ACCOUNT_SID_FIELD: ConnectorAuthField = {
  key: 'accountSid',
  label: 'Account SID',
  secret: false,
  required: true,
  placeholder: 'AC…',
  help: 'Always the Account SID (AC…), even when the credentials below are an API key — it names the account in the request URL, not the caller.',
};
