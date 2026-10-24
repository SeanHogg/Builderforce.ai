/**
 * Inline tool calls carry their arguments as TEXT (`<parameter=edits>[…]</parameter>`);
 * only the advertised schema says what each one is. This types a lifted call against
 * the request's `tools`, the way Qwen3-Coder's own parser does, from the text as the
 * model wrote it (`rawArgs`): a property declared `string` gets that text verbatim
 * (`1.10` stays `1.10`, a JSON file's content stays text), one declared `object` /
 * `array` / `number` / `integer` / `boolean` is parsed into that type when it reads as
 * one. An argument with no declared type — or a call with no tag text (a JSON body,
 * whose types the model wrote itself) — keeps the parser's reading.
 */
import type { BrainToolSpec } from './streamChatCompletion';
import type { ParsedXmlToolCall } from './xmlToolCalls';

/** `value` as the JSON-Schema `type` asks, or `undefined` when it does not read as one. */
function asType(value: string, type: unknown): unknown {
  const types = Array.isArray(type) ? type : [type];
  const text = value.trim();
  for (const t of types) {
    if (t === 'string') return undefined;
    if ((t === 'object' || t === 'array') && /^[[{]/.test(text)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        // Not JSON: this type does not take it; the text stays as written.
        parsed = undefined;
      }
      if (t === 'array' ? Array.isArray(parsed) : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
    if ((t === 'number' || t === 'integer') && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
      const n = Number(text);
      if (t === 'number' || Number.isInteger(n)) return n;
    }
    if (t === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  }
  return undefined;
}

/** The call as the run sees it: the native tool-call shape, its tag text dropped. */
const plain = ({ id, name, args }: ParsedXmlToolCall): ParsedXmlToolCall => ({ id, name, args });

/** `calls` with each argument typed by its tool's schema in `tools`. */
export function typeXmlToolArgs(calls: readonly ParsedXmlToolCall[], tools: readonly BrainToolSpec[] | undefined): ParsedXmlToolCall[] {
  const schemas = new Map((tools ?? []).map((t) => [t.function.name, t.function.parameters]));
  return calls.map((call) => plain(typed(call, schemas)));
}

function typed(call: ParsedXmlToolCall, schemas: Map<string, Record<string, unknown>>): ParsedXmlToolCall {
  const props = (schemas.get(call.name)?.properties ?? undefined) as Record<string, { type?: unknown }> | undefined;
  if (!props) return call;
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(call.args) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return call;
    args = parsed as Record<string, unknown>;
  } catch {
    return call;
  }
  let changed = false;
  for (const [key, value] of Object.entries(args)) {
    const type = props[key]?.type;
    if (type === undefined) continue;
    const text = call.rawArgs?.[key] ?? (typeof value === 'string' ? value : undefined);
    if (text === undefined) continue;
    const next = type === 'string' || (Array.isArray(type) && type[0] === 'string') ? text : asType(text, type);
    if (next === undefined || next === value) continue;
    args[key] = next;
    changed = true;
  }
  return changed ? { ...call, args: JSON.stringify(args) } : call;
}
