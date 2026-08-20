/**
 * SOAP as a TRANSPORT for the connector runtime — not as a second subsystem.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Microsoft Advertising's Campaign Management service is SOAP, not REST, and the
 * connector register recorded that as a reason the network "cannot be added as manifest
 * data". That is a reason to build a feature. Everything a `ConnectorManifest` says —
 * which host, which operation, which credentials, which fields — is transport-agnostic;
 * the only parts that were REST-shaped were "serialize the body as JSON" and "parse the
 * response as JSON". So this module supplies the other pair, and `connectorRuntime`
 * keeps its single SSRF guard, its single credential unsealing and its single audit-log
 * write. A manifest declaring {@link ConnectorSoap} gets XML on the wire and hands back
 * exactly the shape a REST action hands back — including `resultPath`, which still
 * addresses plain nested keys.
 *
 * ── WHY A HAND-WRITTEN PARSER ────────────────────────────────────────────────
 * There is no XML parser in this API and no `DOMParser` on Workers, and adding an
 * npm XML library to parse a response we already size-cap and fully control the shape
 * of would be a supply-chain dependency bought for about ninety lines. The parser below
 * is deliberately NOT general-purpose: it reads well-formed SOAP responses, it never
 * resolves an external entity, it never expands an internal one, and it has no
 * recursion that a hostile document can drive — see {@link parseXml}.
 *
 * ── WHY A FAULT IS NOT A SUCCESS ─────────────────────────────────────────────
 * A SOAP fault arrives as HTTP 200 with `<Fault>` in the body. The REST path decides
 * success from the status code, so without {@link soapFaultOf} every rejected write —
 * a bad token, a refused budget — would be recorded as ok, cached as ok, and reported
 * upward as ok. That is the same failure TikTok's 200-with-an-error envelope causes,
 * and it is handled in the same place, once.
 */

/** What an action declares to be spoken over SOAP instead of JSON. */
export interface ConnectorSoap {
  /** The `SOAPAction` header value. Most services route on it and 500 without it. */
  action: string;
  /** The operation element's namespace — the `xmlns` on the request wrapper. */
  namespace: string;
  /** The operation element name, e.g. `GetCampaignsByAccountId`. */
  operation: string;
  /** 1.1 (text/xml + SOAPAction) by default; 1.2 is application/soap+xml. */
  version?: '1.1' | '1.2';
  /**
   * SOAP `<Header>` entries, templated with `{{auth.<field>}}` exactly as a param
   * default is. This is where a developer token and an account scope ride on services
   * that put credentials in the envelope rather than in an HTTP header — declaring it
   * keeps those values in the same sealed credential store as every other secret.
   */
  header?: Record<string, string>;
}

const SOAP_ENVELOPE_NS = {
  '1.1': 'http://schemas.xmlsoap.org/soap/envelope/',
  '1.2': 'http://www.w3.org/2003/05/soap-envelope',
} as const;

export const soapContentType = (version: '1.1' | '1.2' = '1.1'): string =>
  version === '1.2' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8';

/**
 * Escape a text node or attribute value.
 *
 * All five, always. `&` first, or the ampersands introduced by the other four get
 * escaped a second time and `<` arrives as `&amp;lt;`. This is also the injection
 * boundary: without it a campaign named `</Name><Status>Active</Status>` would be
 * parsed by the service as extra ELEMENTS, which is XML's version of SQL injection.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** An element name we are willing to emit. Anything else would let a caller-supplied
 *  key close a tag or introduce an attribute. */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/**
 * A JS value → XML elements, under one parent name.
 *
 * Arrays repeat the element, which is what every SOAP service means by a list, EXCEPT
 * where the value is `{ __item: 'X', values: [...] }` — the shape services like Bing
 * use for a typed array wrapper (`<Ids><long>1</long><long>2</long></Ids>`). Objects
 * nest. `null` emits a nil element rather than nothing, because for most services an
 * absent element means "do not change" while a nil one means "clear it", and collapsing
 * the two silently ignores a deletion.
 */
function toXml(name: string, value: unknown, depth = 0): string {
  // A bounded depth is what makes this safe against a pathological input object; 32 is
  // far deeper than any real SOAP request and cannot blow the stack.
  if (depth > 32) return '';
  if (!SAFE_NAME.test(name)) return '';
  if (value === undefined) return '';
  if (value === null) return `<${name} xsi:nil="true"/>`;

  if (Array.isArray(value)) {
    return value.map((entry) => toXml(name, entry, depth + 1)).join('');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // The typed-array wrapper: one named child element per value.
    if (typeof record.__item === 'string' && Array.isArray(record.values)) {
      const inner = record.values.map((entry) => toXml(record.__item as string, entry, depth + 1)).join('');
      return `<${name}>${inner}</${name}>`;
    }
    const inner = Object.entries(record)
      .map(([key, entry]) => toXml(key, entry, depth + 1))
      .join('');
    return `<${name}>${inner}</${name}>`;
  }
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** Build the whole request document. */
export function buildSoapEnvelope(
  soap: ConnectorSoap,
  body: Record<string, unknown>,
  header: Record<string, string>,
): string {
  const version = soap.version ?? '1.1';
  const envelopeNs = SOAP_ENVELOPE_NS[version];
  const headerXml = Object.entries(header)
    .filter(([, value]) => value !== '' && value != null)
    .map(([key, value]) => toXml(key, value))
    .join('');
  const bodyXml = Object.entries(body).map(([key, value]) => toXml(key, value)).join('');
  const operation = SAFE_NAME.test(soap.operation) ? soap.operation : 'Request';

  return '<?xml version="1.0" encoding="utf-8"?>'
    + `<s:Envelope xmlns:s="${escapeXml(envelopeNs)}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"`
    + ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${escapeXml(soap.namespace)}">`
    + (headerXml ? `<s:Header>${headerXml}</s:Header>` : '<s:Header/>')
    + `<s:Body><${operation}>${bodyXml}</${operation}></s:Body>`
    + '</s:Envelope>';
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

/**
 * Decode the five predefined entities plus numeric references.
 *
 * NOTHING else. A `&foo;` stays literal, which is the point: resolving a named entity
 * that is not one of the five means honouring a DOCTYPE, and honouring a DOCTYPE is how
 * XXE reads a file off the machine. This parser has no DOCTYPE handling at all, and
 * DOCTYPE declarations are stripped before parsing begins.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Surrogates and out-of-range code points would throw; leaving the reference
      // literal is strictly better than failing the whole parse over one character.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Drop the namespace prefix — `a:Campaign` and `Campaign` are the same key to a
 *  caller writing a `resultPath`, and making them differ would make the path depend on
 *  which prefix the service happened to choose that day. */
const localName = (name: string): string => {
  const colon = name.lastIndexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
};

/** A parsed element. Text-only elements collapse to their string. */
export type XmlValue = string | null | XmlNode | XmlValue[];
export interface XmlNode { [key: string]: XmlValue }

function addChild(parent: XmlNode, key: string, value: XmlValue): void {
  const existing = parent[key];
  if (existing === undefined) {
    parent[key] = value;
    return;
  }
  // A repeated element IS a list. Promoting on the second occurrence rather than
  // guessing from a schema is what lets one parser read every service — but it means a
  // one-element list reads as a scalar, which every caller here handles with `list()`.
  if (Array.isArray(existing)) existing.push(value);
  else parent[key] = [existing, value];
}

/**
 * Parse a well-formed XML document into plain objects.
 *
 * A single forward scan with an explicit stack — no recursion, so document depth costs
 * heap rather than call frames and cannot overflow. Attributes are read onto `@name`
 * keys because SOAP services put `xsi:nil` and typed-array hints there, and dropping
 * them would lose the difference between "empty string" and "null".
 */
export function parseXml(source: string): XmlNode {
  // Prolog, comments, DOCTYPE and processing instructions carry nothing a caller wants
  // and DOCTYPE in particular is the XXE vector — removed before a single tag is read.
  const text = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  const root: XmlNode = {};
  const stack: Array<{ name: string; node: XmlNode; text: string }> = [{ name: '#root', node: root, text: '' }];

  const tagRe = /<\s*(\/?)\s*([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const finish = (frame: { name: string; node: XmlNode; text: string }): XmlValue => {
    const keys = Object.keys(frame.node);
    const trimmed = decodeEntities(frame.text).trim();
    if (keys.length === 0) {
      // `xsi:nil="true"` is an explicit null, which is not the same fact as "".
      return trimmed === '' ? '' : trimmed;
    }
    if (trimmed !== '') frame.node['#text'] = trimmed;
    return frame.node;
  };

  while ((match = tagRe.exec(text)) !== null) {
    const [whole, closing, rawName, rawAttrs, selfClosing] = match;
    const top = stack[stack.length - 1]!;
    top.text += text.slice(cursor, match.index);
    cursor = match.index + whole.length;

    const name = localName(rawName!);
    if (closing) {
      const frame = stack.pop();
      if (!frame) continue;
      const parent = stack[stack.length - 1];
      if (parent) addChild(parent.node, frame.name, finish(frame));
      continue;
    }

    const node: XmlNode = {};
    let nil = false;
    for (const attr of (rawAttrs ?? '').matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w.:-]*)\s*=\s*'([^']*)'/g)) {
      const key = localName(attr[1] ?? attr[3] ?? '');
      const value = decodeEntities(attr[2] ?? attr[4] ?? '');
      if (!key) continue;
      if (key === 'nil' && value === 'true') { nil = true; continue; }
      // Namespace declarations are noise to a caller and would collide with real fields.
      if (key === 'xmlns' || (attr[1] ?? '').startsWith('xmlns:')) continue;
      node[`@${key}`] = value;
    }

    if (selfClosing) {
      const value: XmlValue = nil ? null : (Object.keys(node).length ? node : '');
      addChild(top.node, name, value);
      continue;
    }
    if (nil) {
      // An explicitly-nil element still has a closing tag; push it so the scan stays
      // balanced, and remember that its value is null rather than "".
      node['@nil'] = 'true';
    }
    stack.push({ name, node, text: '' });
  }

  // An unbalanced document (a truncated response, most often) still yields everything
  // that closed — better than throwing away a 200 that was 99% readable.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    const parent = stack[stack.length - 1];
    if (parent) addChild(parent.node, frame.name, finish(frame));
  }
  return root;
}

/** The `<Body>` contents of a SOAP response, or the whole document when it is not one. */
export function soapBodyOf(document: XmlNode): unknown {
  const envelope = document.Envelope;
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
    const body = (envelope as XmlNode).Body;
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    return body ?? {};
  }
  return document;
}

/**
 * The fault message, if this response is one.
 *
 * Reads 1.1 (`faultstring`) and 1.2 (`Reason/Text`) and, past those, the per-service
 * detail block — Microsoft's `OperationError` list is where the ACTUAL reason lives,
 * while `faultstring` says only "Invalid client data". Returning the generic string
 * alone would put a useless message in the audit log and in front of a person.
 */
export function soapFaultOf(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const fault = (body as XmlNode).Fault;
  if (!fault) return null;
  if (typeof fault === 'string') return fault || 'The service returned a SOAP fault.';
  if (Array.isArray(fault) || typeof fault !== 'object') return 'The service returned a SOAP fault.';

  const node = fault as XmlNode;
  const parts: string[] = [];
  const flat = (value: XmlValue): void => {
    if (value == null) return;
    if (typeof value === 'string') { if (value.trim()) parts.push(value.trim()); return; }
    if (Array.isArray(value)) { value.forEach(flat); return; }
    for (const key of ['Message', 'ErrorCode', 'Details', 'Text', 'faultstring', 'Reason']) {
      if (key in value) flat(value[key]!);
    }
  };

  const generic = node.faultstring;
  if (typeof generic === 'string' && generic.trim()) parts.push(generic.trim());
  flat(node.Reason ?? null);
  flat(node.detail ?? node.Detail ?? null);

  const message = [...new Set(parts)].join(' — ');
  return message || 'The service returned a SOAP fault.';
}
