/**
 * TEST A CONNECTED ACCOUNT FROM THIS MACHINE — the probe for an account a client calls
 * itself (Kimi Code), run by the client that actually calls it.
 *
 * Why not the gateway's Test (`POST /llm/provider-keys/:provider/test`): the gateway can
 * reach such an account only through an online agent host, and an editor is not one. Its
 * probe then answers "reachable only from a machine of your own" for an account that works
 * perfectly from the editor, and says nothing about whether it does. The question a Test
 * button asks is "does the account work from HERE", so the probe runs here, against the
 * endpoint and credential the client's own calls use.
 *
 * One minimal real request: `GET {root}/v1/models` (free, and it proves the credential and
 * the edge). A runtime whose surface has no catalog route (404/405/501) is asked a 1-token
 * completion on the account's lead model instead. The request goes through `fetchLocal`, so
 * a token that expired early gets the same single replacement a real turn would.
 *
 * Host-neutral: the fetch is injected, and the outcome carries the provider's real HTTP
 * status and message — the host words it (a toast, a composer row) in its own language.
 */
import { fetchLocal, localChatCompletionsUrl, localModelsUrl, type LocalEndpoint } from '@builderforce/local-inference';
import { errorDetail } from './port.js';

/** The account as its client calls it. */
export interface AccountUnderTest {
  provider: string;
  /** The account's endpoint — `credential` is asked for the token right before the call. */
  endpoint: LocalEndpoint;
  /** The account's lead model (the credential's position 0) — what a completion probe runs.
   *  Empty when the account lists none: the catalog answer then stands, with no completion. */
  model: string;
  /** The provider chooses sampling (no `temperature` sent) — the registry's `providerSampling`. */
  providerSampling?: boolean;
}

/** What the provider answered. */
export type AccountTestRemedy =
  /** The credential was refused (401/403): connect the account again. */
  | 'reconnect'
  /** The account is out of capacity (402/429): wait for the plan's window to reset. */
  | 'wait'
  /** Anything else: the status and message say what. */
  | 'none';

export type AccountTestOutcome =
  /** The provider served the request — the account works from this machine. */
  | { kind: 'working'; provider: string; model: string; status: number }
  /** The provider answered with a refusal. `status`/`message` are the provider's own. */
  | { kind: 'refused'; provider: string; model: string; status: number; message: string; remedy: AccountTestRemedy }
  /** No answer from the provider (network, DNS, TLS, timeout). */
  | { kind: 'unreachable'; provider: string; detail: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** How long one probe request may take before it counts as unreachable. */
export const ACCOUNT_TEST_TIMEOUT_MS = 20_000;

/** A runtime that has no catalog route answers one of these to `GET /v1/models`. */
const NO_CATALOG_ROUTE = new Set([404, 405, 501]);

function remedyFor(status: number): AccountTestRemedy {
  if (status === 401 || status === 403) return 'reconnect';
  if (status === 402 || status === 429) return 'wait';
  return 'none';
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text.trim().slice(0, 300) || undefined;
  }
}

/** The provider's own sentence for a refusal: an OpenAI-shaped `{ error: { message } }`,
 *  a flat `{ error | message }`, a short text body, else the bare status. */
function providerMessage(body: unknown, status: number): string {
  if (typeof body === 'string' && body) return body;
  const nested = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  if (nested && typeof nested === 'object') {
    const message = (nested as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return errorDetail(body, status);
}

/**
 * Probe the account with one minimal real request from this machine. Never throws.
 */
export async function testAccountFromThisMachine(account: AccountUnderTest, fetchImpl: FetchLike): Promise<AccountTestOutcome> {
  const { provider, endpoint, model } = account;
  const call = async (url: string, init: RequestInit): Promise<Response> => {
    const signal = AbortSignal.timeout(ACCOUNT_TEST_TIMEOUT_MS);
    const headers = { accept: 'application/json', ...(endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {}), ...(init.headers as Record<string, string> | undefined) };
    return fetchLocal(endpoint, fetchImpl, url, { ...init, headers, signal });
  };
  const decide = async (res: Response): Promise<AccountTestOutcome> => {
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: 'working', provider, model, status: res.status };
    }
    const message = providerMessage(await bodyOf(res), res.status);
    return { kind: 'refused', provider, model, status: res.status, message, remedy: remedyFor(res.status) };
  };
  try {
    const listed = await call(localModelsUrl(endpoint.baseUrl), { method: 'GET' });
    if (!NO_CATALOG_ROUTE.has(listed.status) || !model) return await decide(listed);
    await listed.body?.cancel().catch(() => undefined);
    const completed = await call(localChatCompletionsUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
        ...(account.providerSampling ? {} : { temperature: 0 }),
      }),
    });
    return await decide(completed);
  } catch (error) {
    return { kind: 'unreachable', provider, detail: error instanceof Error ? error.message : String(error) };
  }
}
