/**
 * Validation of the DATA mappings an action may carry — `response`, `applicants`,
 * `boardJobs` and `resolve` — for built-in and tenant-authored manifests alike.
 *
 * Split from `connectorManifest.ts` (types, auth, params, SOAP, the manifest gate) because
 * these four are one family: each is a handful of selector lists plus a URL template or a
 * pattern, and they share three primitives that used to be written four times —
 * {@link validateSelectorList}, {@link validateUrlTemplate} and
 * {@link templateConnectionFields}. One rule per primitive, one error sentence per rule.
 *
 * This file imports TYPES only from the manifest module, so the manifest can import the
 * validators and re-export the constants without a cycle.
 */

import type {
  ConnectorApplicantMapping,
  ConnectorBoardJobMapping,
  ConnectorParam,
  ConnectorResponseMapping,
  ConnectorUrlResolution,
} from './connectorManifest';

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** What an action key may be — one rule for the action itself and for every reference to one. */
export const ACTION_KEY_RE = /^[a-z0-9][a-z0-9_]{0,62}$/;

/** A body path (`a.b.0.c`) or a `header:<name>` selector. Deliberately narrow: no
 *  wildcards, no filters — a selector is a location, never a query language. */
export const RESPONSE_SELECTOR_RE = /^(?:header:[A-Za-z0-9-]{1,64}|[A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,11})$/;
/** Like {@link RESPONSE_SELECTOR_RE}, but a segment may be `*` — "any element of this
 *  array". Allowed ONLY where a manifest asks "does ANY of these equal X"
 *  (`applicants.postingIdField`); a value read for storage must name one location. */
export const MEMBERSHIP_SELECTOR_RE = /^[A-Za-z0-9_$-]{1,64}(?:\.(?:[A-Za-z0-9_$-]{1,64}|\*)){0,11}$/;
/** Fallbacks per field. More than this is a manifest guessing, not declaring. */
export const MAX_RESPONSE_SELECTORS = 6;

/** The SELECTOR fields a {@link ConnectorResponseMapping} may declare — the closed list. */
export const CONNECTOR_RESPONSE_FIELDS = ['externalId', 'url', 'error', 'postId'] as const;
/** The selector fields of a {@link ConnectorApplicantMapping}. */
export const CONNECTOR_APPLICANT_FIELDS = ['externalId', 'postingIdField', 'candidateId', 'name', 'firstName', 'lastName', 'email', 'appliedAt'] as const;
/** The selector fields of a {@link ConnectorBoardJobMapping}. */
export const CONNECTOR_BOARD_JOB_FIELDS = ['externalId', 'title', 'state', 'url'] as const;

/** `{externalId}` / `{postId}` / `{connection.field}` placeholders a URL template may use. */
export const URL_TEMPLATE_PLACEHOLDER_RE = /\{(externalId|postId|connection\.[a-zA-Z0-9_]{1,40})\}/g;

/** Longest regex source a manifest may declare, and longest input one is run against. */
export const MAX_PATTERN_LENGTH = 100;
export const MAX_PATTERN_INPUT = 256;

/**
 * THE extractor for the `connection.<field>` names a URL template reads — one function
 * for the validator, the distributor and the resolver, so they cannot disagree on which
 * fields a template needs.
 */
export function templateConnectionFields(template: string | undefined): string[] {
  if (!template) return [];
  return [...template.matchAll(URL_TEMPLATE_PLACEHOLDER_RE)]
    .map((m) => m[1]!)
    .filter((name) => name.startsWith('connection.'))
    .map((name) => name.slice('connection.'.length));
}

/**
 * A selector list: one selector or 1–{@link MAX_RESPONSE_SELECTORS} of them, each a
 * dotted body path (and, where `allowHeader`, a `header:<name>`). Pushes ONE error and
 * returns null on any fault.
 */
export function validateSelectorList(
  value: unknown,
  label: string,
  errors: string[],
  opts: { allowHeader?: boolean; allowWildcard?: boolean } = {},
): string[] | null {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value.map(String) : [];
  const shapeOk = (selector: string): boolean => (opts.allowWildcard
    ? MEMBERSHIP_SELECTOR_RE.test(selector)
    : RESPONSE_SELECTOR_RE.test(selector) && (opts.allowHeader || !selector.startsWith('header:')));
  const ok = list.length > 0 && list.length <= MAX_RESPONSE_SELECTORS && list.every(shapeOk);
  if (!ok) {
    errors.push(`${label}: must be 1–${MAX_RESPONSE_SELECTORS} ${opts.allowHeader ? 'dotted body paths or header:<name> selectors' : opts.allowWildcard ? 'dotted body paths (a segment may be *)' : 'dotted body paths'}`);
    return null;
  }
  return list;
}

/**
 * A URL template, with the rules that keep it from building an address the manifest's
 * author did not write:
 *   • https:// only, at most 500 characters, and ONLY the three known placeholders;
 *   • the SCHEME AND HOST are literal — no placeholder before the first `/` after
 *     `https://`, so no template can be pointed at another host by a value;
 *   • `{connection.<field>}` names a field declared `secret: false` in `auth.fields`
 *     (`publicFields`) — a secret credential must never be rendered into a link the
 *     canvas shows, and an undeclared field is not a connection fact at all.
 * Pushes ONE error and returns null on a fault.
 */
export function validateUrlTemplate(
  value: unknown,
  label: string,
  publicFields: ReadonlySet<string>,
  errors: string[],
): string | null {
  const template = typeof value === 'string' ? value.trim() : '';
  if (!/^https:\/\//.test(template) || template.length > 500 || /[{}]/.test(template.replace(URL_TEMPLATE_PLACEHOLDER_RE, ''))) {
    errors.push(`${label}: must be an https:// URL using only {externalId}, {postId} and {connection.<field>} placeholders`);
    return null;
  }
  const afterScheme = template.slice('https://'.length);
  const host = afterScheme.split(/[/?#]/, 1)[0] ?? '';
  if (/[{}]/.test(host) || host.length === 0) {
    errors.push(`${label}: the scheme and host must be literal — put no placeholder before the first "/" after https://`);
    return null;
  }
  for (const field of templateConnectionFields(template)) {
    if (!publicFields.has(field)) {
      errors.push(`${label}: {connection.${field}} must name an auth field declared with secret: false`);
      return null;
    }
  }
  return template;
}

/**
 * THE pattern grammar. A manifest's id pattern is not a general regular expression — a
 * "valid, short, no nested quantifier" check is a deny-list, and a deny-list is how
 * `(a|aa)+` and `(a{1,9}){1,9}` get through. It is exactly:
 *
 *     <literal prefix> ( <class> | <class captured> ) <literal suffix>
 *
 * where the literal text is `[A-Za-z0-9:_./-]` only, and `<class>` is `\d+` or
 * `[A-Za-z0-9_-]+` — ONE unbounded run of one character class, which cannot backtrack
 * catastrophically. Anything else is rejected at manifest validation, so no tenant
 * pattern reaches a `RegExp` that was not built from this grammar. It is still applied
 * anchored (`^(?:…)$`) to an input of at most {@link MAX_PATTERN_INPUT} characters.
 */
const PATTERN_GRAMMAR = /^[A-Za-z0-9:_./-]*(?:\((?:\\d\+|\[A-Za-z0-9_-\]\+)\)|\\d\+|\[A-Za-z0-9_-\]\+)[A-Za-z0-9:_./-]*$/;

export function validatePattern(value: unknown, label: string, errors: string[]): string | null {
  const source = typeof value === 'string' ? value : '';
  if (source.length === 0 || source.length > MAX_PATTERN_LENGTH || !PATTERN_GRAMMAR.test(source)) {
    errors.push(`${label}: must be an optional literal prefix, one run of \\d+ or [A-Za-z0-9_-]+ (optionally in parentheses to capture it), and an optional literal suffix — at most ${MAX_PATTERN_LENGTH} characters`);
    return null;
  }
  return source;
}

/**
 * Run a declared pattern the way every consumer must: anchored, on a bounded input.
 *
 * `.` in the grammar's literal text is a LITERAL dot (`urn.li.job` must not match
 * `urnxlixjob`): the grammar allows it only as literal text, so every dot in the source is
 * escaped here — the character classes it can sit beside contain none.
 */
export function matchesPattern(pattern: string, input: string): RegExpExecArray | null {
  if (input.length > MAX_PATTERN_INPUT) return null;
  try { return new RegExp(`^(?:${pattern.replace(/\./g, '\\.')})$`).exec(input); } catch { return null; }
}

/** The `secret: false` auth field keys — what `{connection.<field>}` may name. */
export function publicAuthFieldKeys(fields: ReadonlyArray<{ key: string; secret: boolean }>): ReadonlySet<string> {
  return new Set(fields.filter((field) => !field.secret).map((field) => field.key));
}

/** Pick the declared selector fields of `raw` into `out`, validating each. */
function selectorFields(
  raw: Record<string, unknown>,
  fields: readonly string[],
  labelPrefix: string,
  errors: string[],
  out: Record<string, unknown>,
): void {
  for (const field of fields) {
    if (raw[field] === undefined) continue;
    const list = validateSelectorList(raw[field], `${labelPrefix}.${field}`, errors, { allowWildcard: field === 'postingIdField' });
    if (list) out[field] = list;
  }
}

/** Validate a url-resolution mapping (selectors are dotted paths; the pattern must be safe). */
export function validateUrlResolution(
  raw: unknown,
  params: Record<string, ConnectorParam>,
  publicFields: ReadonlySet<string>,
  where: string,
  errors: string[],
): ConnectorUrlResolution | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) { errors.push(`${where}.resolve: must be an object`); return null; }
  const out: ConnectorUrlResolution = {};
  for (const field of ['listPath', 'matchField'] as const) {
    if (raw[field] === undefined) continue;
    const list = validateSelectorList(raw[field], `${where}.resolve.${field}`, errors);
    if (list?.length === 1) out[field] = list[0]!;
  }
  if (raw.idParam !== undefined) {
    if (typeof raw.idParam !== 'string' || !params[raw.idParam]) errors.push(`${where}.resolve.idParam: must be a declared param`);
    else out.idParam = raw.idParam;
  }
  if (raw.idEncoding !== undefined) {
    if (raw.idEncoding !== 'restli-list') errors.push(`${where}.resolve.idEncoding: must be "restli-list"`);
    else if (!out.idParam || params[out.idParam]?.in !== 'query' || params[out.idParam]?.raw !== true) {
      // An encoded key run through the query encoder is encoded twice.
      errors.push(`${where}.resolve.idEncoding: the idParam must be a query param declared raw: true`);
    } else out.idEncoding = 'restli-list';
  }
  if (raw.equals !== undefined) {
    if (typeof raw.equals !== 'string' || raw.equals.length > 200) errors.push(`${where}.resolve.equals: must be a string of at most 200 characters`);
    else out.equals = raw.equals;
  }
  if ((out.matchField === undefined) !== (out.equals === undefined)) {
    errors.push(`${where}.resolve: matchField and equals go together`);
  }
  selectorFields(raw, ['url', 'resolvedId'], `${where}.resolve`, errors, out as Record<string, unknown>);
  if (raw.resolvedIdPattern !== undefined) {
    const pattern = validatePattern(raw.resolvedIdPattern, `${where}.resolve.resolvedIdPattern`, errors);
    if (pattern) out.resolvedIdPattern = pattern;
  }
  if (raw.urlTemplate !== undefined) {
    const template = validateUrlTemplate(raw.urlTemplate, `${where}.resolve.urlTemplate`, publicFields, errors);
    if (template) out.urlTemplate = template;
  }
  if (!out.url && !out.urlTemplate) errors.push(`${where}.resolve: declare url selectors or a urlTemplate`);
  return out;
}

/** Validate a board-job mapping: dotted body paths only, `externalId` and `title` required. */
export function validateBoardJobMapping(raw: unknown, where: string, errors: string[]): ConnectorBoardJobMapping | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) { errors.push(`${where}.boardJobs: must be an object`); return null; }
  const out: Record<string, unknown> = {};
  selectorFields(raw, CONNECTOR_BOARD_JOB_FIELDS, `${where}.boardJobs`, errors, out);
  if (!out.externalId || !out.title) errors.push(`${where}.boardJobs: externalId and title are required`);
  return out as unknown as ConnectorBoardJobMapping;
}

/** `filterIdFrom` and `nextToken` of an applicant mapping (see their declarations). */
function validateApplicantLookups(
  raw: Record<string, unknown>,
  params: Record<string, ConnectorParam>,
  where: string,
  errors: string[],
  out: Record<string, unknown>,
): void {
  if (raw.filterIdFrom !== undefined) {
    const f = raw.filterIdFrom;
    const select = isPlainObject(f) ? validateSelectorList(f.select, `${where}.applicants.filterIdFrom.select`, errors) : null;
    if (!isPlainObject(f) || typeof f.action !== 'string' || !ACTION_KEY_RE.test(f.action) || typeof f.idParam !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(f.idParam)) {
      errors.push(`${where}.applicants.filterIdFrom: must be { action, idParam, select }`);
    } else if (select) {
      out.filterIdFrom = { action: f.action, idParam: f.idParam, select };
    }
  }
  if (raw.nextToken !== undefined) {
    const t = raw.nextToken;
    const select = isPlainObject(t) ? validateSelectorList(t.select, `${where}.applicants.nextToken.select`, errors) : null;
    const fromQuery = isPlainObject(t) ? t.fromQuery : undefined;
    if (!isPlainObject(t) || typeof t.param !== 'string' || !params[t.param]) {
      errors.push(`${where}.applicants.nextToken: param must be a declared param`);
    } else if (fromQuery !== undefined && (typeof fromQuery !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(fromQuery))) {
      errors.push(`${where}.applicants.nextToken.fromQuery: must be a query param name`);
    } else if (t.done !== undefined && !(isPlainObject(t.done) && typeof t.done.select === 'string'
      && RESPONSE_SELECTOR_RE.test(t.done.select) && !t.done.select.startsWith('header:')
      && typeof t.done.equals === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(t.done.equals))) {
      errors.push(`${where}.applicants.nextToken.done: must be { select: <dotted body path>, equals: <short text> }`);
    } else if (select) {
      const done = isPlainObject(t.done) ? { select: String(t.done.select), equals: String(t.done.equals) } : undefined;
      out.nextToken = { select, param: t.param, ...(typeof fromQuery === 'string' ? { fromQuery } : {}), ...(done ? { done } : {}) };
    }
  }
}

/**
 * Validate an applicant mapping: every selector list is a body path, the param that
 * carries the board's posting id is a declared param, and a cursor (when declared)
 * names a declared param and says what it is made of.
 */
export function validateApplicantMapping(
  raw: unknown,
  params: Record<string, ConnectorParam>,
  where: string,
  errors: string[],
  opts: { lenient?: boolean } = {},
): ConnectorApplicantMapping | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) { errors.push(`${where}.applicants: must be an object`); return null; }
  const postingParam = String(raw.postingParam ?? '');
  if (!params[postingParam]) errors.push(`${where}.applicants.postingParam: "${postingParam}" is not a declared param`);
  const out: Record<string, unknown> = { postingParam };
  selectorFields(raw, CONNECTOR_APPLICANT_FIELDS, `${where}.applicants`, errors, out);
  if (!out.externalId) errors.push(`${where}.applicants.externalId: required — it is the dedupe key`);
  validateApplicantLookups(raw, params, where, errors, out);
  // A stored mapping written before `order` was required: `desc` is the safe reading
  // (it re-reads rather than skips), so a lenient READ supplies it; a WRITE still must say.
  const order = raw.order ?? (opts.lenient && raw.cursorParam !== undefined ? 'desc' : undefined);
  if (isPlainObject(raw.page)) {
    const pageParam = String(raw.page.param ?? '');
    const sizeParam = raw.page.sizeParam === undefined ? undefined : String(raw.page.sizeParam);
    if (!params[pageParam] || (sizeParam !== undefined && !params[sizeParam])) {
      errors.push(`${where}.applicants.page: param/sizeParam must be declared params`);
    } else {
      out.page = { param: pageParam, ...(sizeParam ? { sizeParam } : {}), ...(typeof raw.page.size === 'number' ? { size: raw.page.size } : {}) };
    }
  }
  if (raw.limit !== undefined) {
    const limit = raw.limit;
    if (!isPlainObject(limit) || typeof limit.param !== 'string' || !params[limit.param]
      || typeof limit.size !== 'number' || !Number.isInteger(limit.size) || limit.size < 1 || limit.size > 1000) {
      errors.push(`${where}.applicants.limit: must be { param: <declared param>, size: 1–1000 }`);
    } else {
      out.limit = { param: limit.param, size: limit.size };
    }
  }
  if (order !== undefined) {
    if (order !== 'asc' && order !== 'desc') errors.push(`${where}.applicants.order: must be "asc" or "desc"`);
    else out.order = order;
  }
  if (raw.cursorParam !== undefined) {
    const from = raw.cursorFrom;
    const format = raw.cursorFormat ?? 'iso';
    if (typeof raw.cursorParam !== 'string' || !params[raw.cursorParam]) {
      errors.push(`${where}.applicants.cursorParam: must be a declared param`);
    } else if (order !== 'asc' && order !== 'desc') {
      errors.push(`${where}.applicants: a cursor needs "order" ("asc" or "desc") — it decides what a capped run has proven`);
    } else if ((from !== 'appliedAt' && from !== 'id') || (format !== 'iso' && format !== 'epochMs')) {
      errors.push(`${where}.applicants: cursorFrom must be "appliedAt" or "id", and cursorFormat "iso" or "epochMs"`);
    } else if (from === 'appliedAt' && !out.appliedAt) {
      errors.push(`${where}.applicants: a cursor from appliedAt needs appliedAt selectors`);
    } else {
      out.cursorParam = raw.cursorParam;
      out.cursorFrom = from;
      out.cursorFormat = format;
    }
  }
  return out as unknown as ConnectorApplicantMapping;
}

/**
 * Validate a response mapping on an untrusted action.
 *
 * A single string is accepted and normalised to a one-entry list, because that is how
 * a hand-authored manifest will most often say it. A malformed declaration is an ERROR
 * rather than a silent drop: dropping it would turn "the board confirmed this id" into
 * "no id", which the distribute use case records as a failure the author cannot
 * explain.
 */
export function validateResponseMapping(
  raw: unknown,
  publicFields: ReadonlySet<string>,
  where: string,
  errors: string[],
): ConnectorResponseMapping | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) { errors.push(`${where}.response: must be an object`); return null; }
  const out: ConnectorResponseMapping = {};
  for (const [field, value] of Object.entries(raw)) {
    if (field === 'externalIdPattern') {
      const pattern = validatePattern(value, `${where}.response.externalIdPattern`, errors);
      if (pattern) out.externalIdPattern = pattern;
    } else if (field === 'urlTemplate') {
      const template = validateUrlTemplate(value, `${where}.response.urlTemplate`, publicFields, errors);
      if (template) out.urlTemplate = template;
    } else if (!(CONNECTOR_RESPONSE_FIELDS as readonly string[]).includes(field)) {
      errors.push(`${where}.response.${field}: unknown field — use one of ${CONNECTOR_RESPONSE_FIELDS.join(', ')}, urlTemplate, externalIdPattern`);
    } else {
      const list = validateSelectorList(value, `${where}.response.${field}`, errors, { allowHeader: true });
      if (list) (out as Record<string, string[]>)[field] = list;
    }
  }
  return Object.keys(out).length ? out : null;
}
