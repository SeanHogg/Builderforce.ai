/**
 * Error mapping and re-wrapping for the local-first transport — one concern, split out of
 * `localFirstTransport.ts`:
 *
 *  - {@link providerErrorMapper}: a non-OK response from an account-backed runtime (Kimi
 *    Code) that refuses the CREDENTIAL names the provider to sign in to; anything else
 *    (a plan, region or quota refusal included) maps exactly as the gateway's do.
 *  - {@link withModelRef}: an interruption / transport failure re-reported under the full
 *    `local/<runtime>/<model>` ref.
 *  - {@link withFailedAccounts}: the account pool's final gateway error, prefixed with the
 *    accounts that were tried first — every field of the original error kept.
 */

import type { LocalFirstAttemptRecord } from '@builderforce/local-inference';
import { RepetitionLoopError, StreamInterruptedError, TransportError, readErrorBody } from './streamChatCompletion';
import { BrainRequestError, PROVIDER_AUTH_REQUIRED, brainRequestError } from './chatError';

/**
 * Machine codes that mean the credential itself was refused. Read FIRST: a body that carries
 * a code is answered by it, never by a loose word in its prose.
 */
const AUTH_CODE =
  /^(?:invalid_api_key|invalid_key|invalid_token|token_expired|expired_token|invalid_grant|invalid_credentials?|authentication_error|authentication_failed|unauthori[sz]ed|unauthenticated|not_authenticated|key_revoked|revoked_key)$/i;

/**
 * Phrases that say the CREDENTIAL was refused. Never a bare "token" or "key": a quota
 * ("monthly token limit reached") or a plan ("this key's plan does not allow region X")
 * refusal names those words too, and is not a sign-in problem.
 */
const AUTH_PHRASE = new RegExp(
  [
    String.raw`\bunauthori[sz]ed\b`,
    String.raw`\bunauthenticated\b`,
    String.raw`\bnot\s+authenticated\b`,
    String.raw`\bauthentication\s+(?:failed|required|error)\b`,
    String.raw`\b(?:invalid|bad|wrong|incorrect|revoked|expired|missing|unknown|malformed)\s+(?:api[_ -]?key|key|access\s+token|token|credentials?|bearer)\b`,
    String.raw`\b(?:api[_ -]?key|access\s+token|token|credentials?|session)\s+(?:is\s+|has\s+|was\s+)?(?:invalid|expired|revoked|not\s+valid|been\s+revoked)\b`,
    String.raw`\bsign\s*in\s+again\b`,
  ].join('|'),
  'i',
);

/** The machine codes a 403 body carries (`code`, `error.code`, `error.type`). */
function codesOf(body: { code?: unknown; error?: unknown }): string[] {
  const err = typeof body.error === 'object' && body.error !== null ? (body.error as { code?: unknown; type?: unknown }) : undefined;
  return [body.code, err?.code, err?.type].filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** A 403 body that says the CREDENTIAL was refused (as opposed to a plan, region or quota refusal). */
export function refusesCredential(body: unknown): boolean {
  const b = (body ?? {}) as { code?: unknown; error?: unknown; message?: unknown };
  const codes = codesOf(b);
  if (codes.some((c) => AUTH_CODE.test(c))) return true;
  const text = [typeof b.error === 'string' ? b.error : (b.error as { message?: unknown } | undefined)?.message, b.message]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  return AUTH_PHRASE.test(text);
}

/**
 * Maps a non-OK response from an account-backed runtime: a 401 (or a 403 whose body says the credential was refused)
 * names the provider to sign in to; every other status, a plan or region 403 included, maps as the gateway's do.
 */
export function providerErrorMapper(provider: string, label: string): (res: Response) => Promise<Error> {
  return async (res) => {
    const body = await readErrorBody(res);
    const mapped = brainRequestError(res.status, body, res.statusText);
    if (res.status !== 401 && !(res.status === 403 && refusesCredential(body))) return mapped;
    return new BrainRequestError(`${label} rejected the sign-in (${res.status}). ${mapped.message}`, {
      status: res.status,
      code: PROVIDER_AUTH_REQUIRED,
      provider,
      providerLabel: label,
    });
  };
}

/** An interruption or transport failure re-reported under the full ref (`local/kimi-code/k3`), not the bare id the runtime echoes. */
export function withModelRef(e: unknown, ref: string): unknown {
  if (e instanceof RepetitionLoopError || !(e instanceof StreamInterruptedError || e instanceof TransportError)) return e;
  if (e.model === ref) return e;
  const out = e instanceof StreamInterruptedError
    ? new StreamInterruptedError(e.message, ref, e.detail, { pinned: e.pinned })
    : new TransportError(e.message, ref, { cause: e.cause, unreachable: e.unreachable, pinned: e.pinned });
  out.name = e.name;
  if (e.stack) out.stack = e.stack;
  if (e instanceof StreamInterruptedError && e.cause !== undefined) (out as { cause?: unknown }).cause = e.cause;
  return out;
}

/**
 * The account pool's final error, honest about the accounts that were tried first: when
 * the gateway's strict BYO leg then fails with its own `BrainRequestError` ("no provider is
 * connected on this workspace"), the person is also told which account failed and why.
 *
 * The re-wrap is a CLONE: same prototype, EVERY own property of the original copied (so a
 * field added to `BrainRequestError` later is never silently dropped), only the message
 * prefixed, and the original carried as `cause`. Any other error is returned as it came
 * (a Stop, a transport failure).
 */
export function withFailedAccounts(e: unknown, failed: readonly LocalFirstAttemptRecord[]): unknown {
  if (!(e instanceof BrainRequestError) || failed.length === 0) return e;
  const prefix = failed
    .map((r) => `${r.attempt.kind === 'local' ? r.attempt.ref : 'account'} could not take this turn (${r.detail ?? r.outcome}). `)
    .join('');
  const out = Object.create(Object.getPrototypeOf(e) as object) as BrainRequestError;
  Object.defineProperties(out, Object.getOwnPropertyDescriptors(e));
  Object.defineProperty(out, 'message', { value: prefix + e.message, writable: true, configurable: true, enumerable: false });
  // The stack's first line is `<name>: <message>` — re-headed so a logged stack reads the prefixed message too.
  // (The header was captured in `super()`, before `name` was set, so it may read `Error: …`.)
  if (typeof e.stack === 'string') {
    const nl = e.stack.indexOf('\n');
    const first = nl < 0 ? e.stack : e.stack.slice(0, nl);
    const frames = nl < 0 ? '' : e.stack.slice(nl);
    const stack = first.endsWith(e.message) ? `${e.name}: ${out.message}${frames}` : `${e.name}: ${out.message}\n${e.stack}`;
    Object.defineProperty(out, 'stack', { value: stack, writable: true, configurable: true, enumerable: false });
  }
  if (!Object.prototype.hasOwnProperty.call(e, 'cause')) {
    Object.defineProperty(out, 'cause', { value: e, writable: true, configurable: true, enumerable: false });
  }
  return out;
}
