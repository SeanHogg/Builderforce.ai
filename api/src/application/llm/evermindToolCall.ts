/**
 * evermindToolCall — function calling for Evermind, the gateway's OWN SSM.
 *
 * Evermind used to REFUSE every tool-bearing request, on the reasoning that a head
 * which generates raw text cannot emit `tool_calls` and that narrating a call is
 * worse than an error. The refusal was right about the failure mode and wrong about
 * the remedy: "can the architecture emit a JSON tool call?" is not a property of the
 * weights at all, it is a property of the DECODING STRATEGY. A tiny under-trained
 * head asked to free-generate `{"name":…,"arguments":{…}}` will indeed produce
 * malformed junk — so this module never asks it to.
 *
 * The approach is schema-driven CONSTRAINED DECODING (the jsonformer/outlines shape):
 * the JSON is ASSEMBLED HERE as a real JS object from the tool's JSON Schema, and the
 * model is only ever consulted for the leaves it is qualified to fill:
 *
 *   • a finite choice (which tool, an `enum`, a boolean) → every candidate is SCORED
 *     by likelihood and the argmax wins, so the answer is always a legal value;
 *   • a free value (a string, a number) → generated, then parsed/escaped by us.
 *
 * Structural validity is therefore guaranteed BY CONSTRUCTION — the braces, quotes,
 * commas and key names are never sampled, so there is no such thing as a malformed
 * Evermind tool call. `JSON.stringify` of a real object cannot be invalid JSON.
 *
 * What that does NOT buy is a good CHOICE, and this is where the original file's
 * instinct is kept rather than discarded. A head that cannot tell `read_file` from
 * `open_pull_request` will still pick one — structurally perfect, semantically a coin
 * flip — and an agent loop acting on coin flips writes files for no reason. So the
 * planner reports the MARGIN between its best and runner-up candidate, and the vendor
 * refuses (400 → cascade) when the head is measurably guessing. Fitness to tool-call
 * is now measured, the same way {@link ./textCoherence} measures fitness to answer in
 * prose, instead of being assumed absent.
 *
 * Pure + port-based (no engine, no R2, no db imports) so the whole planner is unit
 * testable against a fake decoder; the engine-backed adapter lives in
 * {@link ./evermindRuntime}.
 */

/** A tool the model may call, normalized out of the OpenAI wire shape. */
export interface NormalizedTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object (`{ type:'object', properties, required }`). */
  parameters: JsonSchema;
}

/** The slice of JSON Schema this decoder understands. Anything unrecognised is
 *  filled as a string, which is always representable. */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

/**
 * What the caller's `tool_choice` resolved to. Mirrors the OpenAI contract:
 * `none` never calls, `auto` lets the model decide, `required` must call something,
 * and a pinned function forces exactly one.
 */
export type ToolChoicePlan =
  | { mode: 'none' }
  | { mode: 'auto' }
  | { mode: 'required' }
  | { mode: 'forced'; name: string };

/**
 * The two capabilities the planner needs from a language model. Kept this narrow so
 * the planner has no engine dependency — {@link ./evermindRuntime} supplies the
 * EvermindLM-backed implementation and tests supply a deterministic fake.
 */
export interface EvermindToolDecoder {
  /**
   * Length-normalized mean log-probability of `continuation` following `prompt`
   * (higher = more likely). Length normalization is what makes candidates of
   * different token counts comparable — without it the shortest tool name wins
   * every vote purely for being short.
   */
  score(prompt: string, continuation: string): number;
  /** Free-text continuation of `prompt`, at most `maxTokens` new tokens. */
  generate(prompt: string, maxTokens: number): string;
}

/**
 * Minimum separation (in mean log-prob) between the winning candidate and the
 * runner-up for a choice to count as a DECISION rather than a coin flip.
 *
 * This is the tool-calling analogue of the coherence bar: it is what stops a
 * structurally-perfect-but-meaningless call from driving an agent loop. Tuned low
 * on purpose — the job is to catch a head with no preference at all (margins at
 * ~1e-3), not to demand confidence a small model never shows.
 */
export const TOOL_CHOICE_MIN_MARGIN = 0.02;

/**
 * The margin bar actually in force, honouring `EVERMIND_TOOL_CHOICE_MIN_MARGIN`.
 *
 * ONE resolver, shared by the serve-time gate and the Studio bench, so the bench can
 * never report a bar the gateway is not applying — the two disagreeing is how an
 * operator concludes a head is fine and then watches it get refused in production.
 *
 * The default is an analytic placeholder and is documented as one. Making it an env
 * knob is what lets it be CALIBRATED: read the logged margins off real heads, find
 * the separation between correct and incorrect choices, set the number — without
 * shipping a deploy to try each candidate value.
 */
export function evermindToolChoiceMinMargin(env?: { EVERMIND_TOOL_CHOICE_MIN_MARGIN?: string }): number {
  const text = env?.EVERMIND_TOOL_CHOICE_MIN_MARGIN?.trim();
  // Empty is ABSENT, checked before the numeric parse: `Number('')` is 0, not NaN, so
  // a declared-but-unset variable — the normal shape of a secret nobody filled in —
  // would otherwise set the bar to zero and silently turn the confidence gate off.
  if (!text) return TOOL_CHOICE_MIN_MARGIN;
  const raw = Number(text);
  // A non-numeric or negative override is ignored rather than obeyed: a bar of NaN
  // compares false against everything, which is the same silent disabling.
  return Number.isFinite(raw) && raw >= 0 ? raw : TOOL_CHOICE_MIN_MARGIN;
}

/**
 * Emit one structured line per tool decision, accepted or refused.
 *
 * Calibration needs the DISTRIBUTION, and the distribution needs every decision —
 * including the ones that passed. Logging only refusals would show exactly the half
 * of the data that cannot tell you whether the bar is too high.
 */
export function logToolChoiceMargin(fields: {
  margin: number;
  bar: number;
  tool: string | null;
  candidates: number;
  refused: boolean;
}): void {
  // Structured single line — greppable in Workers logs as `evermind.tool_choice`.
  console.log(JSON.stringify({
    event: 'evermind.tool_choice',
    margin: Number.isFinite(fields.margin) ? Number(fields.margin.toFixed(6)) : null,
    bar: fields.bar,
    tool: fields.tool,
    candidates: fields.candidates,
    refused: fields.refused,
  }));
}

/** Ceiling on calls emitted in ONE turn. Each additional call costs a full tool vote
 *  plus an argument fill, so this bounds the CPU an agent loop can spend on a single
 *  planning turn — and a head that wants more than this is not planning, it is
 *  looping. */
const MAX_PARALLEL_TOOL_CALLS = 4;

/** Hard caps so a hostile or recursive schema cannot spin the decoder. */
const MAX_SCHEMA_DEPTH = 4;
const MAX_ARRAY_ITEMS = 4;
const MAX_STRING_CHARS = 400;
const STRING_VALUE_TOKENS = 48;
const NUMBER_VALUE_TOKENS = 8;

/** The sentinel candidate representing "don't call a tool, just answer". Scored
 *  alongside the real tools in `auto` mode so one primitive makes the decision. */
const ANSWER_DIRECTLY = 'answer the user directly without calling a tool';

// ── Wire-shape normalization ─────────────────────────────────────────────────

/**
 * Normalize the OpenAI `tools` array into {@link NormalizedTool}s, accepting both the
 * nested chat-completions shape (`{ type:'function', function:{…} }`) and the already
 * flattened Responses shape (`{ type:'function', name, … }`) — the gateway carries
 * both, and a vendor that understood only one would silently see zero tools.
 * Entries without a usable name are dropped rather than half-registered.
 */
export function normalizeEvermindTools(tools: unknown[] | undefined): NormalizedTool[] {
  if (!Array.isArray(tools)) return [];
  const out: NormalizedTool[] = [];
  for (const raw of tools) {
    // A caller's `tools` array is untrusted wire data — a null/scalar entry must be
    // skipped, not dereferenced.
    if (!raw || typeof raw !== 'object') continue;
    const tool = raw as { type?: string; name?: unknown; description?: unknown; parameters?: unknown; function?: Record<string, unknown> };
    const fn = (tool.function ?? tool) as { name?: unknown; description?: unknown; parameters?: unknown };
    const name = typeof fn.name === 'string' ? fn.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: (fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object' }) as JsonSchema,
    });
  }
  return out;
}

/**
 * Resolve the caller's `tool_choice` against the tools actually on offer. A pinned
 * function that isn't in the list degrades to `required` rather than forcing a name
 * the caller never declared (which would produce a call no agent loop can dispatch).
 */
export function resolveEvermindToolChoice(toolChoice: unknown, tools: NormalizedTool[]): ToolChoicePlan {
  if (tools.length === 0) return { mode: 'none' };
  if (toolChoice === 'none') return { mode: 'none' };
  if (toolChoice === 'required') return { mode: 'required' };
  if (toolChoice === 'auto' || toolChoice == null) return { mode: 'auto' };
  const pinned = toolChoice as { type?: string; name?: unknown; function?: { name?: unknown } };
  if (pinned && typeof pinned === 'object' && pinned.type === 'function') {
    // Accept both the nested and flattened spellings, exactly as `normalizeEvermindTools` does.
    const name = typeof pinned.function?.name === 'string' ? pinned.function.name
      : typeof pinned.name === 'string' ? pinned.name
        : '';
    if (name && tools.some((t) => t.name === name)) return { mode: 'forced', name };
    return { mode: 'required' };
  }
  return { mode: 'auto' };
}

// ── Prompt rendering ─────────────────────────────────────────────────────────

/** One line per tool: the signature the model is choosing between. */
function renderToolSignature(tool: NormalizedTool): string {
  const props = tool.parameters?.properties ?? {};
  const required = new Set(tool.parameters?.required ?? []);
  const args = Object.entries(props)
    .map(([key, schema]) => `${key}${required.has(key) ? '' : '?'}: ${schemaTypeName(schema)}`)
    .join(', ');
  return `- ${tool.name}(${args})${tool.description ? ` — ${tool.description}` : ''}`;
}

/**
 * The tool catalogue, rendered into the prompt so the head's choice is INFORMED by
 * the descriptions rather than made from the tool names alone. Shared by the decision
 * vote and every argument fill so the model sees one consistent context.
 */
export function renderToolsPreamble(tools: NormalizedTool[]): string {
  return `Available tools:\n${tools.map(renderToolSignature).join('\n')}`;
}

/** Human-readable type for a schema node, used in the rendered signatures. */
function schemaTypeName(schema: JsonSchema | undefined): string {
  if (!schema) return 'string';
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum.map((v) => JSON.stringify(v)).join('|');
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'array') return `${schemaTypeName(schema.items)}[]`;
  return type ?? 'string';
}

// ── Scoring primitives ───────────────────────────────────────────────────────

/** A resolved finite choice: what won, and by how much over the runner-up. */
interface Decision<T> {
  value: T;
  /** Winner's mean log-prob minus the runner-up's. `Infinity` when unopposed. */
  margin: number;
}

/**
 * Pick the most likely candidate and report the separation. This is the ONE place a
 * finite choice is made — the tool vote, `enum` values and booleans all route through
 * it, so "how does Evermind choose?" has a single answer and a single margin
 * definition. A single candidate is unopposed (`Infinity`): there is nothing to
 * second-guess, so it must not be judged as a low-confidence guess.
 */
function decide<T>(decoder: EvermindToolDecoder, prompt: string, candidates: Array<{ value: T; text: string }>): Decision<T> {
  if (candidates.length === 0) throw new Error('decide() requires at least one candidate');
  const first = candidates[0]!;
  if (candidates.length === 1) return { value: first.value, margin: Infinity };
  let best = first;
  let bestScore = -Infinity;
  let runnerUp = -Infinity;
  for (const candidate of candidates) {
    const score = decoder.score(prompt, candidate.text);
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = candidate;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  return { value: best.value, margin: bestScore - runnerUp };
}

// ── Argument filling ─────────────────────────────────────────────────────────

/** The prompt a leaf value is generated/scored against: conversation + catalogue +
 *  exactly which argument of which tool is being filled. */
function valuePrompt(base: string, tool: NormalizedTool, path: string, schema: JsonSchema | undefined): string {
  const described = schema?.description ? ` (${schema.description})` : '';
  return `${base}\nCalling tool: ${tool.name}\nValue for argument "${path}"${described}, as ${schemaTypeName(schema)}:`;
}

/** First line of a generated value, unquoted and bounded. Free text is never parsed
 *  as JSON — it is escaped by `JSON.stringify` at assembly time, so any bytes the
 *  head emits are representable. */
function cleanStringValue(raw: string, schema: JsonSchema | undefined): string {
  const firstLine = (raw ?? '').split('\n').find((line) => line.trim().length > 0) ?? '';
  const unquoted = firstLine.trim().replace(/^["'`]+/, '').replace(/["'`,]+$/, '').trim();
  const cap = Math.min(schema?.maxLength ?? MAX_STRING_CHARS, MAX_STRING_CHARS);
  return unquoted.slice(0, cap);
}

/** First numeric literal in a generated value, clamped to the schema's bounds.
 *  Falls back to `default` → `minimum` → 0 when the head emitted no number at all. */
function cleanNumberValue(raw: string, schema: JsonSchema | undefined, integer: boolean): number {
  const match = (raw ?? '').match(/-?\d+(\.\d+)?/);
  const fallback = typeof schema?.default === 'number' ? schema.default : schema?.minimum ?? 0;
  let value = match ? Number(match[0]) : fallback;
  if (!Number.isFinite(value)) value = fallback;
  if (typeof schema?.minimum === 'number') value = Math.max(value, schema.minimum);
  if (typeof schema?.maximum === 'number') value = Math.min(value, schema.maximum);
  return integer ? Math.round(value) : value;
}

/**
 * Fill ONE schema node by dispatching on its type — the recursive core of the
 * constrained decoder. Every branch returns a value that is legal for the node, so
 * the assembled object always validates against the shape the tool declared.
 */
function fillValue(
  decoder: EvermindToolDecoder,
  base: string,
  tool: NormalizedTool,
  path: string,
  schema: JsonSchema | undefined,
  depth: number,
  margins: number[],
): unknown {
  // Depth guard: a self-referential schema would otherwise recurse forever. A string
  // is the universally representable leaf, so that is where we bottom out.
  if (depth > MAX_SCHEMA_DEPTH) {
    return cleanStringValue(decoder.generate(valuePrompt(base, tool, path, schema), STRING_VALUE_TOKENS), schema);
  }

  // An `enum` is a finite choice regardless of the declared type — vote, never generate.
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) {
    const decision = decide(decoder, valuePrompt(base, tool, path, schema), schema.enum.map((value) => ({ value, text: String(value) })));
    margins.push(decision.margin);
    return decision.value;
  }

  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type;

  switch (type) {
    case 'boolean': {
      const decision = decide(decoder, valuePrompt(base, tool, path, schema), [
        { value: true, text: 'true' },
        { value: false, text: 'false' },
      ]);
      margins.push(decision.margin);
      return decision.value;
    }
    case 'integer':
      return cleanNumberValue(decoder.generate(valuePrompt(base, tool, path, schema), NUMBER_VALUE_TOKENS), schema, true);
    case 'number':
      return cleanNumberValue(decoder.generate(valuePrompt(base, tool, path, schema), NUMBER_VALUE_TOKENS), schema, false);
    case 'object':
      return fillObject(decoder, base, tool, path, schema, depth, margins);
    case 'array': {
      const items: unknown[] = [];
      const min = Math.max(0, schema?.minItems ?? 0);
      const max = Math.min(schema?.maxItems ?? MAX_ARRAY_ITEMS, MAX_ARRAY_ITEMS);
      for (let i = 0; i < max; i++) {
        if (i >= min) {
          // Length is itself a decision: keep going only while the head prefers it.
          const more = decide(decoder, `${valuePrompt(base, tool, `${path}[${i}]`, schema?.items)}\nIs there another item?`, [
            { value: true, text: 'yes' },
            { value: false, text: 'no' },
          ]);
          if (!more.value) break;
        }
        items.push(fillValue(decoder, base, tool, `${path}[${i}]`, schema?.items, depth + 1, margins));
      }
      return items;
    }
    case 'null':
      return null;
    default:
      // `string` and anything unrecognised. Generating text is always safe: it is
      // escaped at assembly, so an unknown schema keyword degrades to a filled
      // string rather than to invalid JSON.
      return cleanStringValue(decoder.generate(valuePrompt(base, tool, path, schema), STRING_VALUE_TOKENS), schema);
  }
}

/**
 * Fill an object node. Required properties are always present (that is what
 * `required` means); each optional property is a yes/no decision, so the head can
 * produce a minimal call instead of being forced to invent every argument.
 */
function fillObject(
  decoder: EvermindToolDecoder,
  base: string,
  tool: NormalizedTool,
  path: string,
  schema: JsonSchema | undefined,
  depth: number,
  margins: number[],
): Record<string, unknown> {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!required.has(key)) {
      const include = decide(decoder, `${valuePrompt(base, tool, childPath, propSchema)}\nShould this optional argument be provided?`, [
        { value: true, text: 'yes' },
        { value: false, text: 'no' },
      ]);
      if (!include.value) continue;
    }
    out[key] = fillValue(decoder, base, tool, childPath, propSchema, depth + 1, margins);
  }
  return out;
}

// ── The planner ──────────────────────────────────────────────────────────────

/** One planned call. */
export interface EvermindPlannedCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** A planned call plus the evidence for how confidently it was chosen. */
export interface EvermindToolPlan {
  /** The FIRST chosen call, or null when the head elected to answer in prose
   *  (`auto` only). Kept as the single-call view every existing reader uses;
   *  {@link EvermindToolPlan.calls} is the full list. */
  call: EvermindPlannedCall | null;
  /**
   * Every call this turn emits, in order.
   *
   * The OpenAI shape has always been an ARRAY and frontier models emit parallel
   * calls; Evermind used to plan exactly one, so a caller that relies on parallel
   * calls silently got serialized behaviour. After the first call the head is asked
   * "another call?" — the same continue-vote the array filler already uses for list
   * length — so a model with nothing more to do still emits exactly one.
   * Empty when `call` is null.
   */
  calls: EvermindPlannedCall[];
  /**
   * Separation between the winning tool and the runner-up. The vendor gates on this:
   * a head with no preference is guessing, and a guessed tool call is exactly the
   * "silently doing the wrong thing" this backend refuses to do.
   * `Infinity` when the choice was forced or unopposed (nothing was guessed).
   */
  margin: number;
}

/**
 * Choose a tool and fill its arguments under the caller's `tool_choice` contract.
 *
 * The decision and every argument come from the model; the JSON structure comes from
 * the schema. Returns `{ call: null }` only in `auto` mode, and only when answering
 * directly out-scored every tool — `required`/`forced` always produce a call.
 */
export function planEvermindToolCall(
  decoder: EvermindToolDecoder,
  basePrompt: string,
  tools: NormalizedTool[],
  choice: ToolChoicePlan,
): EvermindToolPlan {
  if (choice.mode === 'none' || tools.length === 0) return { call: null, calls: [], margin: Infinity };

  const base = `${basePrompt}\n\n${renderToolsPreamble(tools)}`;
  const margins: number[] = [];

  // 1) Which tool (or none)? `forced` skips the vote entirely — the caller already decided.
  let tool: NormalizedTool | undefined;
  let choiceMargin = Infinity;
  if (choice.mode === 'forced') {
    tool = tools.find((t) => t.name === choice.name);
  } else {
    // In `auto`, "answer directly" competes as a peer candidate, so one vote settles
    // both questions (call vs. answer, and which call) with one comparable margin.
    const candidates: Array<{ value: NormalizedTool | null; text: string }> = tools.map((t) => ({
      value: t,
      text: `${t.name} — ${t.description || t.name}`,
    }));
    if (choice.mode === 'auto') candidates.push({ value: null, text: ANSWER_DIRECTLY });
    const decision = decide(decoder, `${base}\nThe best next action is: `, candidates);
    choiceMargin = decision.margin;
    if (!decision.value) return { call: null, calls: [], margin: choiceMargin };
    tool = decision.value;
  }
  // A `forced` name is validated by `resolveEvermindToolChoice`, so this is a
  // belt-and-braces fallback rather than a reachable branch.
  if (!tool) return { call: null, calls: [], margin: choiceMargin };

  // 2) Fill the arguments object against the tool's own schema.
  const calls: EvermindPlannedCall[] = [
    { name: tool.name, arguments: fillObject(decoder, base, tool, '', tool.parameters, 0, margins) },
  ];

  // 3) Additional PARALLEL calls. `forced` names exactly one tool, so it stops here —
  // asking for more would emit calls the caller never requested. Otherwise the head is
  // asked whether it wants another, exactly as the array filler asks whether a list has
  // another item, so a model with nothing more to do still emits exactly one call.
  if (choice.mode !== 'forced') {
    while (calls.length < MAX_PARALLEL_TOOL_CALLS) {
      const rendered = calls.map((c) => `${c.name}(${JSON.stringify(c.arguments)})`).join('\n');
      const more = decide(decoder, `${base}\nAlready calling:\n${rendered}\nIs there another tool call to make?`, [
        { value: true, text: 'yes' },
        { value: false, text: 'no' },
      ]);
      // A TIE means no. `decide` breaks ties by candidate order, so requiring a
      // positive margin is what keeps "one call" the default: an indifferent head
      // must not have a second call read into its silence.
      if (!more.value || !(more.margin > 0)) break;
      // Counted ONLY when the vote said yes. A head that is indifferent about making
      // a SECOND call has guessed nothing — folding that indifference into the plan
      // margin would let an optional extra drag a confidently-chosen first call below
      // the confidence gate and get the whole turn refused. A coin-flip "yes",
      // though, does put a guessed call in the plan, and counts.
      margins.push(more.margin);

      const next = decide(
        decoder,
        `${base}\nAlready calling:\n${rendered}\nThe next tool to call is: `,
        tools.map((t) => ({ value: t, text: `${t.name} — ${t.description || t.name}` })),
      );
      margins.push(next.margin);
      if (!next.value) break;
      const nextCall: EvermindPlannedCall = {
        name: next.value.name,
        arguments: fillObject(decoder, base, next.value, '', next.value.parameters, 0, margins),
      };
      // An identical repeat is the head LOOPING, not planning parallel work. Stop
      // rather than emit a duplicate an agent loop would faithfully execute twice.
      const duplicate = calls.some(
        (c) => c.name === nextCall.name && JSON.stringify(c.arguments) === JSON.stringify(nextCall.arguments),
      );
      if (duplicate) break;
      calls.push(nextCall);
    }
  }


  // The reported margin is the WEAKEST link in the whole plan: a confident tool
  // choice whose enum argument was a coin flip is still a coin flip overall.
  const weakest = Math.min(choiceMargin, ...margins);
  return { call: calls[0]!, calls, margin: Number.isFinite(weakest) ? weakest : Infinity };
}

/** Wrap a planned call in the OpenAI `tool_calls` wire shape. `id` is supplied by the
 *  caller so the completion builder controls id generation (and tests stay stable). */
export function toOpenAIToolCall(call: { name: string; arguments: Record<string, unknown> }, id: string): Record<string, unknown> {
  return { id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
}
