/**
 * Streaming parser for tool calls a model writes inline in its *text* output.
 *
 * Some models (and weaker gateway-routed ones) don't emit native OpenAI
 * `tool_calls` deltas — they write the call into the content stream as markup.
 * There is no single convention, so this handles every dialect seen in the wild:
 *
 *   <tool_call>delete_task<arg_key>id</arg_key><arg_value>75</arg_value></tool_call>
 *   <function_call>{"name":"delete_task","arguments":{"id":75}}</function_call>
 *   <tool_use>delete_task {"id":75}</tool_use>
 *   <invoke name="delete_task"><parameter name="id">75</parameter></invoke>
 *   <function=delete_task>{"id":75}</function>
 *   <xai:function_call name="delete_task"><parameter name="id">75</parameter></xai:function_call>
 *   <|"0":{"name":"delete_task","arguments":{"id":75}}, "1":{…} ?>
 *
 * Left untouched that markup (a) renders as literal tags in the chat bubble — the
 * "garbled reply" symptom — and (b), worse, means the call NEVER executes, because
 * the agent loop only runs structured `toolCalls`. This filter lifts every dialect
 * into the same `AssembledToolCall` shape the native path produces AND strips the
 * markup from the visible text so only clean narration reaches the UI.
 *
 * It is a streaming filter: deltas arrive in arbitrary chunks (a tag can split
 * across two reads), so it holds back any text that is — or might be the start of —
 * an opening tag, emitting only text that is safe to display.
 *
 * Deliberately NOT handled: a bare ```json fenced block. A fenced block is far more
 * often legitimate content (the model showing the user a payload) than a call, and
 * swallowing those would eat real answers.
 */

/** A tool call lifted out of text, in the native `AssembledToolCall` shape. */
export interface ParsedXmlToolCall {
  id: string;
  name: string;
  /** Raw JSON argument string (parse with `JSON.parse`). */
  args: string;
}

/** Where a call's body ends: `at` is the body's length, `length` the terminator's. */
interface CallEnd {
  at: number;
  length: number;
}

/**
 * One inline dialect. `prefix` is the literal the opening tag starts with (used for
 * the streaming hold-back); `open` matches the whole opening tag, capturing the tool
 * name for the dialects that carry it there.
 */
interface TagDialect {
  prefix: string;
  open: RegExp;
  close: string;
  /** True when `open` captures the tool NAME (so the body is arguments only). */
  namedInOpenTag: boolean;
}

/**
 * A dialect with no closing tag: its body ends where its own syntax does, so the
 * dialect finds that end itself and may carry several calls in one body.
 */
interface SelfClosingDialect {
  prefix: string;
  open: RegExp;
  /**
   * The body's end, or null while more of it may still arrive. `final` is end of
   * stream: nothing more is coming, so it always answers, keeping every complete call.
   */
  closeAt: (buf: string, final: boolean) => CallEnd | null;
  parseBody: (body: string, seq: number) => ParsedXmlToolCall[];
}

type Dialect = TagDialect | SelfClosingDialect;

const isSelfClosing = (dialect: Dialect): dialect is SelfClosingDialect => 'closeAt' in dialect;

/** Index of the first non-whitespace character at or after `i`. */
function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

/** End (exclusive) of the JSON object opening at `text[i] === '{'`, or -1 while it is still arriving. */
function objectEnd(text: string, i: number): number {
  let depth = 0;
  let inString = false;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (inString) {
      if (c === '\\') j += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** A body tail that may still grow into the next `"n": {` key — nothing yet included. */
const PARTIAL_MAP_KEY = /^(?:"\d*"?\s*:?\s*)?$/;
const MAP_KEY = /^"\d+"\s*:\s*/;
/** What Grok writes after the last call: the outer `}`, then `?>` or `|>`, each optional. */
const MAP_TERMINATOR = /^\}?\s*\??\s*\|?>?/;

/**
 * Where a numbered call map ends — after its last `"n": {…}` entry and the terminator
 * trailing it. Mid-stream it waits (null) whenever the next characters could still be
 * another entry or the rest of the terminator; at end of stream an unfinished entry is
 * dropped whole, so only complete calls are parsed.
 */
function callMapEnd(buf: string, final: boolean): CallEnd | null {
  /** Everything from `at` on is unfinished: wait for it, or at end of stream swallow it. */
  const unfinished = (at: number): CallEnd | null => (final ? { at, length: buf.length - at } : null);
  let i = skipSpace(buf, 0);
  if (buf[i] === '{') i = skipSpace(buf, i + 1);
  for (;;) {
    const entryStart = i;
    const rest = buf.slice(i);
    const key = MAP_KEY.exec(rest);
    if (!key) return PARTIAL_MAP_KEY.test(rest) ? unfinished(entryStart) : { at: i, length: 0 };
    i += key[0].length;
    if (i >= buf.length) return unfinished(entryStart);
    if (buf[i] !== '{') return { at: entryStart, length: 0 };
    const end = objectEnd(buf, i);
    if (end < 0) return unfinished(entryStart);
    i = skipSpace(buf, end);
    if (i >= buf.length) return unfinished(end);
    if (buf[i] !== ',') break;
    i = skipSpace(buf, i + 1);
  }
  const rest = buf.slice(i);
  const terminator = MAP_TERMINATOR.exec(rest)![0];
  // `}` or `} ?` at the very end may still be followed by the `>` that finishes it.
  if (!final && terminator.length === rest.length && !terminator.endsWith('>')) return null;
  return { at: i, length: terminator.length };
}

/** Every `{ name, arguments }` entry of a numbered call map, in key order. */
function parseCallMap(body: string, seq: number): ParsedXmlToolCall[] {
  const entries = body.trim().replace(/^\{/, '').replace(/,\s*$/, '');
  let map: Record<string, unknown>;
  try {
    map = JSON.parse(`{${entries}}`) as Record<string, unknown>;
  } catch {
    return [];
  }
  // Integer-like keys enumerate in ascending order, which is the order Grok numbered them.
  return Object.values(map).flatMap((raw, index) => {
    const entry = raw as { name?: unknown; arguments?: unknown } | null;
    if (!entry || typeof entry.name !== 'string' || !entry.name) return [];
    const args = entry.arguments ?? {};
    return [{ id: `xmltc_${seq}_${index}`, name: entry.name, args: typeof args === 'string' ? args : JSON.stringify(args) }];
  });
}

const DIALECTS: Dialect[] = [
  { prefix: '<tool_call>', open: /<tool_call>/, close: '</tool_call>', namedInOpenTag: false },
  { prefix: '<function_call>', open: /<function_call>/, close: '</function_call>', namedInOpenTag: false },
  { prefix: '<tool_use>', open: /<tool_use>/, close: '</tool_use>', namedInOpenTag: false },
  { prefix: '<invoke', open: /<invoke\s+name\s*=\s*"([^"]*)"\s*>/, close: '</invoke>', namedInOpenTag: true },
  { prefix: '<function=', open: /<function\s*=\s*([^>]+)>/, close: '</function>', namedInOpenTag: true },
  // Grok's own dialect, written when it drops out of native function calling:
  // `<xai:function_call name="read_file"><parameter name="path">…</parameter></xai:function_call>`.
  // `<function_call>` above needs the bare tag, so nothing matched it: the calls never
  // ran, the markup reached the transcript as "narration", and Grok, seeing its own
  // calls with no results, concluded the tools were not returning. The name is optional
  // in the pattern so a body carrying `{"name":…}` JSON is lifted too.
  { prefix: '<xai:function_call', open: /<xai:function_call(?:\s+name\s*=\s*"([^"]*)")?\s*>/, close: '</xai:function_call>', namedInOpenTag: true },
  // Grok's numbered call map (chat #106, grok-4.6): `<|"0":{"name":…,"arguments":{…}}, "1":{…} ?>`,
  // with or without the outer braces and never with a closing tag. Four calls written
  // this way ran nothing, and the turn decayed into counting.
  { prefix: '<|', open: /<\|\s*(?=\{?\s*"\d+"\s*:\s*\{)/, closeAt: callMapEnd, parseBody: parseCallMap },
];

/** A tail that could still grow into a numbered call map's opening (`<|`, `<|{"0":`). */
const CALL_MAP_OPEN_TAIL = /<\|\s*\{?\s*(?:"\d*"?\s*:?\s*)?$/;

/**
 * A chat-template control token the model wrote as TEXT: `<|eos|>`, `<|endoftext|>`,
 * `<|im_end|>`, `<|separator|>`, … A model that loses its footing emits its own
 * end-of-sequence marker as ordinary characters instead of stopping on it — Grok
 * finishing a reasoning-only turn with a visible `<<|eos|>` is exactly this. The marker
 * is never content, so it is dropped with any run of `<` glued to its front.
 */
const CONTROL_TOKEN = /<+\|[a-z][a-z0-9_]{0,31}\|>/gi;
/** A tail that could still grow into a control token (`<`, `<<|eo`, `<|eos|`). */
const CONTROL_TOKEN_TAIL = /<+(?:\|[a-z0-9_]{0,32}\|?)?$/i;

/** Text with every leaked control token removed. */
export function stripControlTokens(text: string): string {
  return text.replace(CONTROL_TOKEN, '');
}

/**
 * Longest L (1 ≤ L < tag.length) such that the last L chars of `buf` equal the
 * first L chars of `tag` — i.e. `buf` ends with a *partial* `tag` we must hold
 * back until the next chunk disambiguates it. 0 when there's no partial overlap.
 */
function partialTailPrefix(buf: string, tag: string): number {
  const max = Math.min(buf.length, tag.length - 1);
  for (let L = max; L > 0; L--) {
    if (buf.slice(buf.length - L) === tag.slice(0, L)) return L;
  }
  return 0;
}

/**
 * How many trailing chars of `buf` must be withheld because they could still grow
 * into an opening tag. Covers both a partial literal prefix (`<tool_c`) and a
 * variable-length opening tag that has begun but not closed (`<invoke name="del`).
 */
function holdLength(buf: string): number {
  let hold = 0;
  for (const d of DIALECTS) {
    hold = Math.max(hold, partialTailPrefix(buf, d.prefix));
    if (!isSelfClosing(d) && d.namedInOpenTag) {
      const idx = buf.lastIndexOf(d.prefix);
      if (idx >= 0 && !buf.slice(idx).includes('>')) hold = Math.max(hold, buf.length - idx);
    }
  }
  for (const tailPattern of [CALL_MAP_OPEN_TAIL, CONTROL_TOKEN_TAIL]) {
    const tail = tailPattern.exec(buf);
    if (tail) hold = Math.max(hold, tail[0].length);
  }
  return Math.min(hold, buf.length);
}

/** The earliest opening tag of any dialect in `buf`, or null when there is none. */
function findOpen(buf: string): { dialect: Dialect; index: number; length: number; name?: string } | null {
  let best: { dialect: Dialect; index: number; length: number; name?: string } | null = null;
  for (const dialect of DIALECTS) {
    const m = dialect.open.exec(buf);
    if (!m) continue;
    if (best && m.index >= best.index) continue;
    best = { dialect, index: m.index, length: m[0].length, ...(m[1] ? { name: m[1].trim() } : {}) };
  }
  return best;
}

/** Where the body of an open call ends in `buf`, or null while it is still arriving. */
function callEnd(dialect: Dialect, buf: string): CallEnd | null {
  if (isSelfClosing(dialect)) return dialect.closeAt(buf, false);
  const at = buf.indexOf(dialect.close);
  return at >= 0 ? { at, length: dialect.close.length } : null;
}

/** Coerce an argument payload to a JS value (so `75` → number, `true` → bool). */
function coerceArg(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

const ARG_KEY_VALUE = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
/** `<parameter name="…">`, or Grok's namespaced `<xai:parameter name="…">`. */
const PARAMETER_TAG = /<(?:xai:)?parameter\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/(?:xai:)?parameter>/g;

/**
 * Pull key/value arguments out of a body written in either tag style
 * (`<arg_key>`/`<arg_value>` pairs, or Anthropic-style `<parameter name="…">`).
 * Returns null when the body uses neither, so the caller can fall back to JSON.
 */
function argsFromTags(body: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  let found = false;
  for (const re of [ARG_KEY_VALUE, PARAMETER_TAG]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const key = m[1].trim();
      if (!key) continue;
      args[key] = coerceArg(m[2]);
      found = true;
    }
  }
  return found ? args : null;
}

/** Parse a body whose tool NAME came from the opening tag — arguments only. */
function parseNamedBody(name: string, body: string, seq: number): ParsedXmlToolCall | null {
  if (!name) return null;
  const tagged = argsFromTags(body);
  if (tagged) return { id: `xmltc_${seq}`, name, args: JSON.stringify(tagged) };

  const jsonStart = body.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const obj = JSON.parse(body.slice(jsonStart)) as unknown;
      return { id: `xmltc_${seq}`, name, args: JSON.stringify(obj ?? {}) };
    } catch {
      /* fall through to a no-arg call */
    }
  }
  return { id: `xmltc_${seq}`, name, args: '{}' };
}

/** Parse a body that carries its own tool name (the `<tool_call>`-style dialects). */
function parseInner(inner: string, seq: number): ParsedXmlToolCall | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;

  // Primary format: `name<arg_key>k</arg_key><arg_value>v</arg_value>…`, or the
  // same shape with `<parameter name="k">v</parameter>`.
  const firstArg = trimmed.search(/<arg_key>|<(?:xai:)?parameter\s/);
  if (firstArg >= 0) {
    const name = trimmed.slice(0, firstArg).trim();
    if (!name) return null;
    return { id: `xmltc_${seq}`, name, args: JSON.stringify(argsFromTags(trimmed) ?? {}) };
  }

  // Fallback formats: `name {json-args}` or `{"name":…,"arguments":{…}}`.
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart >= 0) {
    const maybeName = trimmed.slice(0, jsonStart).trim();
    try {
      const obj = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
      if (maybeName) {
        return { id: `xmltc_${seq}`, name: maybeName, args: JSON.stringify(obj ?? {}) };
      }
      if (obj && typeof obj === 'object' && typeof obj.name === 'string') {
        const a = (obj.arguments ?? obj.parameters ?? obj.input ?? {}) as unknown;
        const argsStr = typeof a === 'string' ? a : JSON.stringify(a ?? {});
        return { id: `xmltc_${seq}`, name: obj.name, args: argsStr };
      }
    } catch {
      if (maybeName) return { id: `xmltc_${seq}`, name: maybeName, args: '{}' };
    }
    return null;
  }

  // Bare name, no args.
  return { id: `xmltc_${seq}`, name: trimmed, args: '{}' };
}

/** Call-shaped markup of any dialect, known or not, namespaced or bare. */
const CALL_MARKUP = /<\/?(?:[\w-]+:)?(?:function_call|tool_call|tool_use|invoke)\b/i;

/**
 * Does `text` still carry tool-call markup? The filter strips every call it lifts, so
 * a match in a turn's CLEAN text is a dialect this module does not know: the model
 * tried to call a tool and nothing ran. The run loop records it per turn and the
 * diagnostics name it, so the next unknown dialect shows up as one report line instead
 * of a run that "won't call tools".
 */
export function hasCallMarkup(text: string): boolean {
  return CALL_MARKUP.test(text);
}

/**
 * Stateful streaming filter. Feed `push(delta)`; it returns the clean text safe
 * to display now (markup withheld). Call `flush()` once at end-of-stream.
 */
export class XmlToolCallFilter {
  private buf = '';
  private inside: Dialect | null = null;
  private insideName: string | undefined;
  private innerBuf = '';
  private clean = '';
  private calls: ParsedXmlToolCall[] = [];
  private seq = 0;

  /** Close the call currently being accumulated and record it. A dialect whose name
   *  is optional in the open tag falls back to reading the name from the body. */
  private commit(): void {
    const dialect = this.inside;
    const seq = this.seq++;
    if (dialect && isSelfClosing(dialect)) {
      this.calls.push(...dialect.parseBody(this.innerBuf, seq));
    } else {
      const parsed = dialect?.namedInOpenTag && this.insideName !== undefined
        ? parseNamedBody(this.insideName, this.innerBuf, seq)
        : parseInner(this.innerBuf, seq);
      if (parsed) this.calls.push(parsed);
    }
    this.innerBuf = '';
    this.inside = null;
    this.insideName = undefined;
  }

  /** Feed a content delta; returns clean (markup-free) text to emit now. */
  push(delta: string): string {
    this.buf += delta;
    let emit = '';
    for (;;) {
      if (!this.inside) {
        const open = findOpen(this.buf);
        if (open) {
          emit += this.buf.slice(0, open.index);
          this.buf = this.buf.slice(open.index + open.length);
          this.inside = open.dialect;
          this.insideName = open.name;
          this.innerBuf = '';
          continue;
        }
        // No full open tag: emit everything except a possible partial-tag tail.
        const hold = holdLength(this.buf);
        emit += this.buf.slice(0, this.buf.length - hold);
        this.buf = hold ? this.buf.slice(this.buf.length - hold) : '';
        break;
      }
      const end = callEnd(this.inside, this.buf);
      if (end) {
        this.innerBuf += this.buf.slice(0, end.at);
        this.buf = this.buf.slice(end.at + end.length);
        this.commit();
        continue;
      }
      // Still inside, no end yet: bank all but a possible partial close tail. A
      // self-closing dialect re-reads its whole body for its end, so it banks nothing.
      const hold = isSelfClosing(this.inside) ? this.buf.length : partialTailPrefix(this.buf, this.inside.close);
      this.innerBuf += this.buf.slice(0, this.buf.length - hold);
      this.buf = hold ? this.buf.slice(this.buf.length - hold) : '';
      break;
    }
    emit = stripControlTokens(emit);
    this.clean += emit;
    return emit;
  }

  /** End of stream: flush held-back text and close any unterminated call. */
  flush(): string {
    let emit = '';
    if (this.inside && isSelfClosing(this.inside)) {
      // End of stream closes the body for good; whatever follows its terminator is text.
      const end = this.inside.closeAt(this.buf, true) ?? { at: this.buf.length, length: 0 };
      this.innerBuf += this.buf.slice(0, end.at);
      emit = stripControlTokens(this.buf.slice(end.at + end.length));
      this.commit();
    } else if (this.inside) {
      // Unterminated opening tag — best-effort parse what we accumulated.
      this.innerBuf += this.buf;
      this.commit();
    } else {
      // Held-back tail was never a real open tag — it's just text.
      emit = stripControlTokens(this.buf);
    }
    this.buf = '';
    this.innerBuf = '';
    this.clean += emit;
    return emit;
  }

  /** The full clean text accumulated so far. */
  cleanText(): string {
    return this.clean;
  }

  /** Tool calls lifted out of the text. */
  toolCalls(): ParsedXmlToolCall[] {
    return this.calls;
  }
}

/** One-shot convenience for non-streamed content (the no-reader fallback). */
export function extractXmlToolCalls(raw: string): { text: string; toolCalls: ParsedXmlToolCall[] } {
  const f = new XmlToolCallFilter();
  f.push(raw);
  f.flush();
  return { text: f.cleanText(), toolCalls: f.toolCalls() };
}
