/**
 * Streaming parser for XML-style tool calls embedded in a model's *text* output.
 *
 * Some models (and weaker gateway-routed ones) don't emit native OpenAI
 * `tool_calls` deltas — they write the call inline in the content stream as:
 *
 *   <tool_call>delete_task<arg_key>id</arg_key><arg_value>75</arg_value></tool_call>
 *
 * Left untouched that markup (a) renders as literal text in the chat bubble and
 * (b) — worse — means the call NEVER executes, because the agent loop only runs
 * structured `toolCalls`. This filter lifts those inline calls into the same
 * structured `AssembledToolCall` shape the native path produces, AND strips the
 * markup from the visible text so only clean narration reaches the UI.
 *
 * It is a streaming filter: deltas arrive in arbitrary chunks (a tag can split
 * across two reads), so it holds back any text that is — or might be the start
 * of — a `<tool_call>` boundary, emitting only text that is safe to display.
 */

const OPEN = '<tool_call>';
const CLOSE = '</tool_call>';

/** A tool call lifted out of text, in the native `AssembledToolCall` shape. */
export interface ParsedXmlToolCall {
  id: string;
  name: string;
  /** Raw JSON argument string (parse with `JSON.parse`). */
  args: string;
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

/** Coerce an `<arg_value>` payload to a JS value (so `75` → number, `true` → bool). */
function coerceArg(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Parse one `<tool_call>…</tool_call>` inner body into a structured call. */
function parseInner(inner: string, seq: number): ParsedXmlToolCall | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;

  // Primary format: `name<arg_key>k</arg_key><arg_value>v</arg_value>…`
  const firstArg = trimmed.indexOf('<arg_key>');
  if (firstArg >= 0) {
    const name = trimmed.slice(0, firstArg).trim();
    if (!name) return null;
    const args: Record<string, unknown> = {};
    const re = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      const key = m[1].trim();
      if (key) args[key] = coerceArg(m[2]);
    }
    return { id: `xmltc_${seq}`, name, args: JSON.stringify(args) };
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
        const a = (obj.arguments ?? obj.parameters ?? {}) as unknown;
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
  private inside = false;
  private innerBuf = '';
  private clean = '';
  private calls: ParsedXmlToolCall[] = [];
  private seq = 0;

  /** Feed a content delta; returns clean (markup-free) text to emit now. */
  push(delta: string): string {
    this.buf += delta;
    let emit = '';
    for (;;) {
      if (!this.inside) {
        const open = this.buf.indexOf(OPEN);
        if (open >= 0) {
          emit += this.buf.slice(0, open);
          this.buf = this.buf.slice(open + OPEN.length);
          this.inside = true;
          this.innerBuf = '';
          continue;
        }
        // No full open tag: emit everything except a possible partial-tag tail.
        const hold = partialTailPrefix(this.buf, OPEN);
        emit += this.buf.slice(0, this.buf.length - hold);
        this.buf = hold ? this.buf.slice(this.buf.length - hold) : '';
        break;
      }
      const close = this.buf.indexOf(CLOSE);
      if (close >= 0) {
        this.innerBuf += this.buf.slice(0, close);
        this.buf = this.buf.slice(close + CLOSE.length);
        this.inside = false;
        const parsed = parseInner(this.innerBuf, this.seq++);
        if (parsed) this.calls.push(parsed);
        this.innerBuf = '';
        continue;
      }
      // Still inside, no close yet: bank all but a possible partial close tail.
      const hold = partialTailPrefix(this.buf, CLOSE);
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
      // Unterminated `<tool_call>` — best-effort parse what we accumulated.
      this.innerBuf += this.buf;
      const parsed = parseInner(this.innerBuf, this.seq++);
      if (parsed) this.calls.push(parsed);
    } else {
      // Held-back tail was never a real open tag — it's just text.
      emit = this.buf;
    }
    this.buf = '';
    this.innerBuf = '';
    this.inside = false;
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
