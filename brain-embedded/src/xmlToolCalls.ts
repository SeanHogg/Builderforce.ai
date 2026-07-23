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

/**
 * One inline dialect. `prefix` is the literal the opening tag starts with (used for
 * the streaming hold-back); `open` matches the whole opening tag, capturing the tool
 * name for the dialects that carry it there.
 */
interface Dialect {
  prefix: string;
  open: RegExp;
  close: string;
  /** True when `open` captures the tool NAME (so the body is arguments only). */
  namedInOpenTag: boolean;
}

const DIALECTS: Dialect[] = [
  { prefix: '<tool_call>', open: /<tool_call>/, close: '</tool_call>', namedInOpenTag: false },
  { prefix: '<function_call>', open: /<function_call>/, close: '</function_call>', namedInOpenTag: false },
  { prefix: '<tool_use>', open: /<tool_use>/, close: '</tool_use>', namedInOpenTag: false },
  { prefix: '<invoke', open: /<invoke\s+name\s*=\s*"([^"]*)"\s*>/, close: '</invoke>', namedInOpenTag: true },
  { prefix: '<function=', open: /<function\s*=\s*([^>]+)>/, close: '</function>', namedInOpenTag: true },
];

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
    if (d.namedInOpenTag) {
      const idx = buf.lastIndexOf(d.prefix);
      if (idx >= 0 && !buf.slice(idx).includes('>')) hold = Math.max(hold, buf.length - idx);
    }
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
const PARAMETER_TAG = /<parameter\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/parameter>/g;

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
  const firstArg = trimmed.search(/<arg_key>|<parameter\s/);
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

  /** Close the call currently being accumulated and record it. */
  private commit(): void {
    const parsed = this.inside?.namedInOpenTag
      ? parseNamedBody(this.insideName ?? '', this.innerBuf, this.seq++)
      : parseInner(this.innerBuf, this.seq++);
    if (parsed) this.calls.push(parsed);
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
      const close = this.buf.indexOf(this.inside.close);
      if (close >= 0) {
        this.innerBuf += this.buf.slice(0, close);
        this.buf = this.buf.slice(close + this.inside.close.length);
        this.commit();
        continue;
      }
      // Still inside, no close yet: bank all but a possible partial close tail.
      const hold = partialTailPrefix(this.buf, this.inside.close);
      this.innerBuf += this.buf.slice(0, this.buf.length - hold);
      this.buf = hold ? this.buf.slice(this.buf.length - hold) : '';
      break;
    }
    this.clean += emit;
    return emit;
  }

  /** End of stream: flush held-back text and close any unterminated call. */
  flush(): string {
    let emit = '';
    if (this.inside) {
      // Unterminated opening tag — best-effort parse what we accumulated.
      this.innerBuf += this.buf;
      this.commit();
    } else {
      // Held-back tail was never a real open tag — it's just text.
      emit = this.buf;
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
