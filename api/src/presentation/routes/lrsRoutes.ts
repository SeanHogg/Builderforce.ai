/**
 * THE xAPI ENDPOINT — mounted under /xapi
 *
 *   GET    /about                → what this LRS supports; the one public route
 *   POST   /statements           → store a statement or a batch
 *   PUT    /statements?statementId= → store one at a caller-chosen id
 *   GET    /statements           → query, or fetch one by id
 *   {GET,PUT,POST,DELETE} /activities/state
 *   {GET,PUT,POST,DELETE} /activities/profile
 *   {GET,PUT,POST,DELETE} /agents/profile
 *
 * ── WHY THIS IS NOT UNDER /api AND NOT BEHIND `authMiddleware` ──────────────
 * This is not our API. It is a standard, consumed by authoring tools — Storyline,
 * Captivate, Rise, a dozen others — that will never hold a session JWT and cannot
 * be changed to. They send `Authorization: Basic` against a URL a customer pastes
 * into a settings box, and they will call it `<endpoint>/statements` whatever we
 * would have preferred. So the prefix is the endpoint the customer is given, and
 * authentication is `createLrsAuthMiddleware` — which runs before the per-tenant
 * rate limiter, so a surface with no Bearer token still gets throttled.
 *
 * ── WHY THE HANDLERS ARE THIS THIN ─────────────────────────────────────────
 * Every rule that could be got wrong lives one layer down: statement validation in
 * `domain/learning/xapiStatement`, immutability in `lrsStatements` (a UNIQUE index
 * rather than a read-then-write), and the RFC 7232 preconditions in `lrsDocuments`.
 * What is left here is HTTP: which status a refusal is, and the version header the
 * standard requires on every response.
 *
 * ── THE THREE DOCUMENT RESOURCES SHARE ONE IMPLEMENTATION ──────────────────
 * They differ only in which parts of the address they use, so they are registered
 * from a table by {@link mountDocumentResource}. Writing them out three times is
 * how the `If-Match` handling ends up correct on State and missing on Agent
 * Profile.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  MAX_STATEMENTS_PER_POST, actorKey, parseAgent, parseStatement,
  type XapiStatement,
} from '../../domain/learning/xapiStatement';
import {
  getStatement, queryStatements, storeStatements,
} from '../../application/learning/lrsStatements';
import { touchLrsCredential } from '../../application/learning/lrsCredentials';
import { XAPI_VERSION, forwardStatements } from '../../application/learning/lrsForwarding';
import {
  addressFor, deleteDocument, getDocument, listDocumentIds, postDocument, putDocument,
  type DocumentScope,
} from '../../application/learning/lrsDocuments';

/** Which query parameters each document resource reads. The whole difference
 *  between State, Activity Profile and Agent Profile is this table. */
const DOCUMENT_RESOURCES: ReadonlyArray<{
  path: string;
  scope: DocumentScope;
  /** The query parameter naming the document — `stateId` or `profileId`. */
  idParam: string;
}> = [
  { path: '/activities/state',   scope: 'state',            idParam: 'stateId' },
  { path: '/activities/profile', scope: 'activity_profile', idParam: 'profileId' },
  { path: '/agents/profile',     scope: 'agent_profile',    idParam: 'profileId' },
];

export function createLrsRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // The standard requires this header on every response, including errors, and a
  // client is entitled to refuse a response without it.
  r.use('*', async (c, next) => {
    await next();
    c.header('X-Experience-API-Version', XAPI_VERSION);
  });

  /**
   * The authenticated tenant, or the Response to send.
   *
   * The credential was resolved by `createLrsAuthMiddleware`, which runs BEFORE
   * the rate limiter so the limiter can see a tenant on a surface that carries no
   * Bearer token. This turns that into an answer: a 401 with a `WWW-Authenticate`
   * challenge, which is what makes an authoring tool prompt for credentials
   * instead of reporting an opaque failure.
   */
  const authenticate = (
    c: Context<HonoEnv>,
  ): { ok: true; tenantId: number; connectionId: number } | { ok: false; response: Response } => {
    const tenantId = c.get('tenantId');
    const connectionId = c.get('lrsConnectionId');
    if (tenantId !== undefined && connectionId !== undefined) return { ok: true, tenantId, connectionId };

    const failure = c.get('lrsAuthFailure')
      ?? { ok: false as const, status: 401 as const, detail: 'xAPI requires HTTP Basic authentication' };
    if (failure.status === 401) c.header('WWW-Authenticate', 'Basic realm="xAPI"');
    return { ok: false, response: c.json({ error: failure.detail }, failure.status) };
  };

  // ── About ─────────────────────────────────────────────────────────────────
  // Public by the specification: a client asks what an endpoint supports BEFORE
  // it has been given credentials for it, which is how it decides what to send.
  r.get('/about', (c) => c.json({ version: [XAPI_VERSION] }));

  // ── Statements ────────────────────────────────────────────────────────────

  r.post('/statements', async (c) => {
    const auth = authenticate(c);
    if (!auth.ok) return auth.response;

    const parsed = await readStatements(c);
    if (!parsed.ok) return c.json({ error: parsed.error, problems: parsed.problems }, 400);

    const { stored } = await storeStatements(db, c.env as Env, auth.tenantId, parsed.statements);
    afterAccepting(c, db, auth, parsed.statements);
    return c.json(stored, 200);
  });

  /**
   * PUT stores at an id the CLIENT chose, and answers 204 with no body.
   *
   * Idempotent by the standard's rule and by ours: the unique `event_key` index
   * means a repeat is a no-op rather than a duplicate, so a client that retries a
   * timed-out PUT gets the same 204 and not a conflict about its own statement.
   */
  r.put('/statements', async (c) => {
    const auth = authenticate(c);
    if (!auth.ok) return auth.response;

    const statementId = (c.req.query('statementId') ?? '').trim();
    if (!statementId) return c.json({ error: 'statementId is required on a PUT' }, 400);

    const body = await c.req.json().catch(() => null);
    if (Array.isArray(body)) return c.json({ error: 'a PUT stores exactly one statement' }, 400);

    const parsed = parseStatement(
      { ...(body as Record<string, unknown> | null ?? {}), id: statementId },
      { now: new Date(), newId: () => crypto.randomUUID() },
    );
    if (!parsed.ok) return c.json({ error: 'invalid statement', problems: parsed.problems }, 400);

    await storeStatements(db, c.env as Env, auth.tenantId, [parsed.statement]);
    afterAccepting(c, db, auth, [parsed.statement]);
    return c.body(null, 204);
  });

  r.get('/statements', async (c) => {
    const auth = authenticate(c);
    if (!auth.ok) return auth.response;

    const statementId = (c.req.query('statementId') ?? '').trim();
    if (statementId) {
      const statement = await getStatement(db, auth.tenantId, statementId);
      return statement
        ? c.json(statement.statement)
        : c.json({ error: 'unknown statement' }, 404);
    }

    const agent = agentKeyFrom(c);
    if (!agent.ok) return c.json({ error: agent.detail }, agent.status);

    const { statements, more } = await queryStatements(db, auth.tenantId, {
      agent: agent.key || undefined,
      verbId: c.req.query('verb') ?? undefined,
      activityId: c.req.query('activity') ?? undefined,
      registration: c.req.query('registration') ?? undefined,
      since: dateParam(c.req.query('since')),
      until: dateParam(c.req.query('until')),
      limit: Number(c.req.query('limit')) || undefined,
      ascending: c.req.query('ascending') === 'true',
    });

    return c.json({ statements: statements.map((s) => s.statement), more: more ? '' : undefined });
  });

  for (const resource of DOCUMENT_RESOURCES) mountDocumentResource(r, db, resource, authenticate);

  return r;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

type ParsedBatch =
  | { ok: true; statements: XapiStatement[] }
  | { ok: false; error: string; problems?: unknown };

/**
 * The body of a statement POST — one statement or an array of them, both legal.
 *
 * The whole batch is validated before ANY of it is stored, because the standard
 * says a POST is all-or-nothing: storing the valid half and reporting the rest
 * leaves a client with no way to retry that does not duplicate what succeeded.
 */
async function readStatements(c: Context<HonoEnv>): Promise<ParsedBatch> {
  const body = await c.req.json().catch(() => null);
  if (body === null) return { ok: false, error: 'a JSON body is required' };

  const incoming = Array.isArray(body) ? body : [body];
  if (incoming.length === 0) return { ok: true, statements: [] };
  if (incoming.length > MAX_STATEMENTS_PER_POST) {
    return { ok: false, error: `at most ${MAX_STATEMENTS_PER_POST} statements per request` };
  }

  const now = new Date();
  const statements: XapiStatement[] = [];
  const problems: Array<{ index: number; problems: unknown }> = [];

  for (const [index, raw] of incoming.entries()) {
    const parsed = parseStatement(raw, { now, newId: () => crypto.randomUUID() });
    if (parsed.ok) statements.push(parsed.statement);
    else problems.push({ index, problems: parsed.problems });
  }

  if (problems.length > 0) return { ok: false, error: 'one or more statements are invalid', problems };
  return { ok: true, statements };
}

/**
 * What happens once statements are durably stored.
 *
 * Both consequences — forwarding to external LRSs and stamping the credential as
 * used — are handed to `waitUntil`. The client's answer is about OUR durability;
 * making it wait on a third party turns a stored statement into a timeout, and an
 * xAPI client answers a timeout by retrying.
 */
function afterAccepting(
  c: Context<HonoEnv>,
  db: Db,
  auth: { tenantId: number; connectionId: number },
  statements: XapiStatement[],
): void {
  const env = c.env as Env;
  c.executionCtx.waitUntil(Promise.all([
    forwardStatements(db, env, auth.tenantId, statements),
    touchLrsCredential(db, auth.tenantId, auth.connectionId),
  ]).then(() => undefined));
}

function dateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

type Authenticator = (
  c: Context<HonoEnv>,
) => { ok: true; tenantId: number; connectionId: number } | { ok: false; response: Response };

/**
 * Register the four methods of one document resource.
 *
 * All three resources take the same parameters under different names and enforce
 * the same preconditions, so they are generated rather than written out — the
 * alternative is three near-copies where a fix lands in one of them.
 */
function mountDocumentResource(
  r: Hono<HonoEnv>,
  db: Db,
  resource: { path: string; scope: DocumentScope; idParam: string },
  authenticate: Authenticator,
): void {
  /** The address, or the refusal — one shape, so every handler below is three
   *  lines and none of them has to know how an agent is spelled. */
  const address = (c: Context<HonoEnv>) => {
    const agent = agentKeyFrom(c);
    if (!agent.ok) return agent;
    return addressFor({
      scope: resource.scope,
      activityId: c.req.query('activityId'),
      agentKey: agent.key,
      registration: c.req.query('registration'),
      documentId: c.req.query(resource.idParam),
    });
  };

  const precondition = (c: Context<HonoEnv>) => ({
    ifMatch: c.req.header('If-Match') ?? null,
    ifNoneMatch: c.req.header('If-None-Match') ?? null,
  });

  /**
   * GET is two endpoints in one, which is the specification's design: WITH the
   * document id it returns the document; WITHOUT it, the ids that exist under the
   * same activity and agent. Splitting them into two routes is not possible —
   * they are the same URL.
   */
  r.get(resource.path, async (c) => {
    const auth = authenticate(c);
    if (!auth.ok) return auth.response;

    const documentId = (c.req.query(resource.idParam) ?? '').trim();
    if (!documentId) {
      // The listing addresses a PREFIX, not a document, so it cannot go through
      // `addressFor` — that one refuses a missing document id, which is exactly
      // what this request is.
      const agent = agentKeyFrom(c);
      if (!agent.ok) return c.json({ error: agent.detail }, agent.status);

      const ids = await listDocumentIds(db, c.env as Env, auth.tenantId, {
        scope: resource.scope,
        activityId: resource.scope === 'agent_profile' ? '' : (c.req.query('activityId') ?? '').trim(),
        agentKey: resource.scope === 'activity_profile' ? '' : agent.key,
      }, dateParam(c.req.query('since')));
      return c.json(ids);
    }

    const built = address(c);
    if (!built.ok) return c.json({ error: built.detail }, built.status);

    const document = await getDocument(db, auth.tenantId, built.address);
    if (!document) return c.json({ error: 'unknown document' }, 404);

    // A conditional GET that matches answers 304 with no body — the whole reason a
    // course keeps an ETag is to avoid re-downloading state it already has.
    if (matchesEtag(c.req.header('If-None-Match'), document.etag)) {
      c.header('ETag', `"${document.etag}"`);
      return c.body(null, 304);
    }

    c.header('ETag', `"${document.etag}"`);
    c.header('Last-Modified', new Date(document.updatedAt).toUTCString());
    c.header('Content-Type', document.contentType);
    return typeof document.content === 'string'
      ? c.body(document.content, 200)
      : c.json(document.content as never, 200);
  });

  r.put(resource.path, async (c) => {
    const auth = authenticate(c);
    if (!auth.ok) return auth.response;

    const built = address(c);
    if (!built.ok) return c.json({ error: built.detail }, built.status);

    const body = await readDocumentBody(c);
    const result = await putDocument(db, c.env as Env, auth.tenantId, built.address, body, precondition(c));
    if (!result.ok) return c.json({ error: result.detail }, result.status);

    c.header('ETag', `"${result.etag}"`);
    return c.body(null, 204);
  });

  r.post(resource.path, async (c) => {
    const auth = authenticate(c);
    if (!auth.ok) return auth.response;

    const built = address(c);
    if (!built.ok) return c.json({ error: built.detail }, built.status);

    const body = await readDocumentBody(c);
    const result = await postDocument(db, c.env as Env, auth.tenantId, built.address, body, precondition(c));
    if (!result.ok) return c.json({ error: result.detail }, result.status);

    c.header('ETag', `"${result.etag}"`);
    return c.body(null, 204);
  });

  r.delete(resource.path, async (c) => {
    const auth = authenticate(c);
    if (!auth.ok) return auth.response;

    const built = address(c);
    if (!built.ok) return c.json({ error: built.detail }, built.status);

    const result = await deleteDocument(db, c.env as Env, auth.tenantId, built.address, precondition(c));
    if (!result.ok) return c.json({ error: result.detail }, result.status);
    return c.body(null, 204);
  });
}

/**
 * The body of a document write.
 *
 * A JSON content type is parsed; anything else is kept as the text that arrived.
 * An unparseable JSON body is stored as TEXT rather than refused, because a
 * document resource stores what a client gives it — the content type is the
 * client's claim about its own bytes, and this LRS is not the thing that should
 * decide the claim was wrong.
 */
async function readDocumentBody(c: Context<HonoEnv>): Promise<{ contentType: string; content: unknown }> {
  const contentType = (c.req.header('Content-Type') ?? 'application/json').split(';')[0]!.trim();
  const text = await c.req.text();
  if (!/^application\/(?:[\w.+-]+\+)?json$/i.test(contentType)) {
    return { contentType, content: text };
  }
  try {
    return { contentType, content: JSON.parse(text) };
  } catch {
    return { contentType: 'text/plain', content: text };
  }
}

/**
 * The `agent` query parameter, as a canonical actor key.
 *
 * Absent is legal and yields `''` — an Activity Profile has no agent. Present and
 * unparseable is a 400 and never an ignored filter: a document read that silently
 * drops its agent addresses a DIFFERENT document, and a course would write one
 * learner's state over another's.
 */
function agentKeyFrom(
  c: Context<HonoEnv>,
): { ok: true; key: string } | { ok: false; status: 400; detail: string } {
  const raw = c.req.query('agent');
  if (!raw) return { ok: true, key: '' };
  const actor = parseAgent(raw);
  return actor
    ? { ok: true, key: actorKey(actor) }
    : { ok: false, status: 400, detail: 'agent must be a JSON Agent with exactly one identifier' };
}

/** `If-None-Match` against a stored tag. `*` matches anything that exists, which
 *  on a GET means "I have a copy" and is a 304. */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const values = header.split(',').map((v) => v.trim().replace(/^W\//i, '').replace(/^"|"$/g, ''));
  return values.includes('*') || values.includes(etag);
}
