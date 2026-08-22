/**
 * xAPI (Experience API / Tin Can) STATEMENTS — the vocabulary, as pure values.
 *
 * A statement is `actor · verb · object`, optionally with a result and a context.
 * That is the whole standard's core, and it is the same shape as `activity_log`
 * — which is why this platform's LRS has no statement table (migration 1112) and
 * why everything in this file is arithmetic over the wire format rather than a
 * mapping onto storage. The mapping lives one layer up, in
 * `application/learning/lrsStatements.ts`.
 *
 * ── WHAT IS VALIDATED HERE, AND WHY IT IS STRICT ─────────────────────────────
 * The LRS endpoint is authenticated with a Basic credential a customer pastes
 * into somebody else's authoring tool. It will be sent malformed statements, and
 * the standard's own rule is that an invalid statement is REJECTED — not stored
 * with the bad parts nulled, which is how an LRS ends up full of records nobody
 * can report on. So the parse is total: it either returns a statement every
 * downstream reader can trust, or it says which part failed.
 *
 * ── IDENTIFYING AN ACTOR ─────────────────────────────────────────────────────
 * xAPI gives four "inverse functional identifiers" and says exactly one must be
 * present: `mbox`, `mbox_sha1sum`, `openid`, `account`. {@link actorKey} folds
 * whichever arrived into one canonical string, so the same person recorded by two
 * different authoring tools lands on one timeline instead of two.
 */

/** The four ways xAPI lets an agent be identified. Exactly one per actor. */
export type ActorIdentifier =
  | { kind: 'mbox'; value: string }
  | { kind: 'mbox_sha1sum'; value: string }
  | { kind: 'openid'; value: string }
  | { kind: 'account'; value: string };

export interface XapiActor {
  /** 'Agent' or 'Group'. A Group without its own identifier is anonymous and
   *  cannot be a timeline, so it is refused rather than silently merged. */
  objectType: 'Agent' | 'Group';
  name: string | null;
  identifier: ActorIdentifier;
}

export interface XapiResult {
  /** -1..1. The only score the standard says is comparable across activities. */
  scaled: number | null;
  raw: number | null;
  min: number | null;
  max: number | null;
  success: boolean | null;
  completion: boolean | null;
  /** ISO 8601 duration, e.g. `PT1H30M`. Kept verbatim — reformatting a duration
   *  is how "PT0S" becomes "0 seconds" becomes a bug in somebody's report. */
  duration: string | null;
}

export interface XapiStatement {
  id: string;
  actor: XapiActor;
  verbId: string;
  /** The English display label when one was sent — a fallback for a UI that has
   *  no vocabulary for a custom verb, never a substitute for `verbId`. */
  verbDisplay: string | null;
  /** The activity IRI. */
  objectId: string;
  objectName: string | null;
  objectType: string;
  result: XapiResult | null;
  registration: string | null;
  timestamp: Date;
  /** The exact document as it arrived, minus what the LRS itself sets. Kept so a
   *  GET can return what was PUT, which the standard requires and no projection
   *  onto typed columns can promise. */
  raw: Record<string, unknown>;
}

export type StatementProblem = { field: string; detail: string };
export type ParsedStatement =
  | { ok: true; statement: XapiStatement }
  | { ok: false; problems: StatementProblem[] };

/** The ADL verbs a learning surface actually renders. Open — a custom verb IRI is
 *  legal and is stored — but these are the ones with meaning to the progress
 *  rollup, so they are named rather than string-matched at three call sites. */
export const ADL_VERBS = {
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
  attempted:   'http://adlnet.gov/expapi/verbs/attempted',
  completed:   'http://adlnet.gov/expapi/verbs/completed',
  passed:      'http://adlnet.gov/expapi/verbs/passed',
  failed:      'http://adlnet.gov/expapi/verbs/failed',
  progressed:  'http://adlnet.gov/expapi/verbs/progressed',
} as const;

/** Statements per POST. The standard sets no ceiling, so this is an abuse bound
 *  on an authenticated but externally-driven write path. */
export const MAX_STATEMENTS_PER_POST = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IRI_RE = /^[a-z][a-z0-9+.-]*:/i;
const SHA1_RE = /^[0-9a-f]{40}$/i;

/**
 * Parse one statement off the wire.
 *
 * `now` is injected rather than read, so a test asserts a timestamp instead of
 * tolerating one, and every statement in a batch shares one clock.
 */
export function parseStatement(
  input: unknown,
  context: { now: Date; newId: () => string },
): ParsedStatement {
  const problems: StatementProblem[] = [];
  if (!isRecord(input)) return { ok: false, problems: [{ field: 'statement', detail: 'must be an object' }] };

  const id = typeof input.id === 'string' ? input.id : context.newId();
  if (!UUID_RE.test(id)) problems.push({ field: 'id', detail: 'must be a uuid' });

  const actor = parseActor(input.actor, problems);
  const verb = parseVerb(input.verb, problems);
  const object = parseObject(input.object, problems);

  // A client clock is not trusted to place a statement in the past or the future;
  // an absent or unparseable timestamp is stamped by the LRS, which is what the
  // standard says `stored` is for and what keeps a report's ordering honest.
  const sent = typeof input.timestamp === 'string' ? Date.parse(input.timestamp) : NaN;
  const timestamp = Number.isFinite(sent) ? new Date(sent) : context.now;

  if (problems.length > 0 || !actor || !verb || !object) return { ok: false, problems };

  const contextObj = isRecord(input.context) ? input.context : null;
  const registration = contextObj && typeof contextObj.registration === 'string' && UUID_RE.test(contextObj.registration)
    ? contextObj.registration
    : null;

  return {
    ok: true,
    statement: {
      id,
      actor,
      verbId: verb.id,
      verbDisplay: verb.display,
      objectId: object.id,
      objectName: object.name,
      objectType: object.objectType,
      result: parseResult(input.result),
      registration,
      timestamp,
      raw: { ...input, id, timestamp: timestamp.toISOString() },
    },
  };
}

/**
 * The canonical, stable identity of an actor.
 *
 * `mailto:` is stripped and the address lower-cased, because `MAILTO:A@B.com` and
 * `mailto:a@b.com` are the same person and an LRS that disagrees produces two
 * half-complete transcripts. An `account` is `homePage|name`, which is the pair
 * the standard says is jointly unique.
 */
export function actorKey(actor: XapiActor): string {
  const { kind, value } = actor.identifier;
  return `${kind}:${value}`;
}

function parseActor(input: unknown, problems: StatementProblem[]): XapiActor | null {
  if (!isRecord(input)) {
    problems.push({ field: 'actor', detail: 'is required' });
    return null;
  }

  const objectType = input.objectType === 'Group' ? 'Group' : 'Agent';
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 255) : null;
  const identifier = readIdentifier(input);
  if (!identifier) {
    problems.push({
      field: 'actor',
      detail: 'needs exactly one of mbox, mbox_sha1sum, openid or account',
    });
    return null;
  }
  return { objectType, name, identifier };
}

function readIdentifier(input: Record<string, unknown>): ActorIdentifier | null {
  const found: ActorIdentifier[] = [];

  if (typeof input.mbox === 'string' && /^mailto:.+@.+/i.test(input.mbox)) {
    found.push({ kind: 'mbox', value: input.mbox.slice('mailto:'.length).trim().toLowerCase() });
  }
  if (typeof input.mbox_sha1sum === 'string' && SHA1_RE.test(input.mbox_sha1sum)) {
    found.push({ kind: 'mbox_sha1sum', value: input.mbox_sha1sum.toLowerCase() });
  }
  if (typeof input.openid === 'string' && IRI_RE.test(input.openid)) {
    found.push({ kind: 'openid', value: input.openid.trim() });
  }
  if (isRecord(input.account)
    && typeof input.account.homePage === 'string'
    && typeof input.account.name === 'string'
    && input.account.homePage.trim() && input.account.name.trim()) {
    found.push({ kind: 'account', value: `${input.account.homePage.trim()}|${input.account.name.trim()}` });
  }

  // "Exactly one" is the standard's word. Two identifiers is an authoring tool
  // that has confused two people, and picking one of them at random is how the
  // wrong learner gets the certificate.
  return found.length === 1 ? found[0]! : null;
}

function parseVerb(input: unknown, problems: StatementProblem[]): { id: string; display: string | null } | null {
  if (!isRecord(input) || typeof input.id !== 'string' || !IRI_RE.test(input.id)) {
    problems.push({ field: 'verb.id', detail: 'must be an IRI' });
    return null;
  }
  const display = isRecord(input.display)
    ? Object.values(input.display).find((v): v is string => typeof v === 'string') ?? null
    : null;
  return { id: input.id.trim(), display: display ? display.slice(0, 120) : null };
}

function parseObject(input: unknown, problems: StatementProblem[]): { id: string; name: string | null; objectType: string } | null {
  if (!isRecord(input) || typeof input.id !== 'string' || !IRI_RE.test(input.id)) {
    // Statement references and sub-statements are legal xAPI and deliberately
    // unsupported: this LRS records what a learner did to an ACTIVITY, and
    // accepting a shape no reader here understands would store data that can
    // never be reported on.
    problems.push({ field: 'object.id', detail: 'must be an Activity with an IRI id' });
    return null;
  }
  const definition = isRecord(input.definition) ? input.definition : null;
  const nameMap = definition && isRecord(definition.name) ? definition.name : null;
  const name = nameMap
    ? Object.values(nameMap).find((v): v is string => typeof v === 'string') ?? null
    : null;

  return {
    id: input.id.trim(),
    name: name ? name.slice(0, 255) : null,
    objectType: typeof input.objectType === 'string' ? input.objectType : 'Activity',
  };
}

function parseResult(input: unknown): XapiResult | null {
  if (!isRecord(input)) return null;
  const score = isRecord(input.score) ? input.score : null;
  return {
    scaled: clampNumber(score?.scaled, -1, 1),
    raw: finiteOrNull(score?.raw),
    min: finiteOrNull(score?.min),
    max: finiteOrNull(score?.max),
    success: typeof input.success === 'boolean' ? input.success : null,
    completion: typeof input.completion === 'boolean' ? input.completion : null,
    duration: typeof input.duration === 'string' ? input.duration.slice(0, 64) : null,
  };
}

/** A `scaled` outside -1..1 is DROPPED rather than clamped: clamping 7 to 1
 *  invents a perfect score nobody achieved. */
function clampNumber(value: unknown, min: number, max: number): number | null {
  const n = finiteOrNull(value);
  return n !== null && n >= min && n <= max ? n : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
