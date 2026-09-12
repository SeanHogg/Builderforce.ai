/**
 * Data-transform node handlers — pure evaluation of the payload, no network and
 * no stored state: the ETL kinds (`transform`/`filter`), the fan-in reducers
 * (`merge` + the three `*-aggregator` kinds) and the Text Parser tools.
 *
 * The ETL kinds are evaluated by the sandbox-safe expression engine in
 * `domain/workflowExpr` (no eval/Function). An empty expression is a
 * pass-through, so legacy workflows are unaffected.
 */
import { evaluateBool, renderTransform } from '../../../domain/workflowExpr';
import {
  regexMatch, htmlToText, htmlTable, htmlElements, matchElements,
  matchPatternAdvanced, replaceText, chunkText, convertEncoding,
} from '../../../domain/workflowTextTools';
import { expressionContext, fanInParts, renderTemplate } from './helpers';
import type { NodeHandlerTable } from './types';

export const TRANSFORM_NODE_HANDLERS: NodeHandlerTable = {
  transform: async ({ node, inputText, usageCtx }) => {
    const expression = typeof node.config.expression === 'string' ? node.config.expression : '';
    const ctx = await expressionContext(inputText, usageCtx, [expression]);
    return { output: renderTransform(expression, inputText, ctx) };
  },

  filter: async ({ node, inputText, usageCtx }) => {
    const predicate = typeof node.config.predicate === 'string' ? node.config.predicate : '';
    const ctx = await expressionContext(inputText, usageCtx, [predicate]);
    // Predicate holds → forward the payload; fails → drop it, which prunes the
    // whole downstream cone of this filter (the drain loop cancels dependents
    // of a dropped node — see `dispositionFromDeps`).
    return evaluateBool(predicate, ctx) ? { output: inputText } : { output: '', drop: true };
  },

  merge: ({ node, inputText }) => {
    const strategy = typeof node.config.strategy === 'string' ? node.config.strategy : 'array';
    const parts = fanInParts(node, inputText);
    const parseOrRaw = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
    if (strategy === 'first') return { output: parts[0] ?? '' };
    if (strategy === 'object-keys') {
      const keys = typeof node.config.keys === 'string'
        ? node.config.keys.split(',').map((k) => k.trim()).filter(Boolean)
        : [];
      const obj: Record<string, unknown> = {};
      parts.forEach((p, i) => { obj[keys[i] ?? `output${i + 1}`] = parseOrRaw(p); });
      return { output: JSON.stringify(obj) };
    }
    return { output: JSON.stringify(parts.map(parseOrRaw)) };
  },

  'numeric-aggregator': ({ node, inputText }) => {
    // Same raw-depOutputs fan-in as `merge`, reduced to one number — Make's
    // Numeric aggregator. Non-numeric branch outputs are dropped rather than
    // failing the node (an aggregate over "the numbers that were there").
    const op = typeof node.config.op === 'string' ? node.config.op : 'sum';
    const nums = fanInParts(node, inputText).map((p) => Number(p)).filter((n) => Number.isFinite(n));
    let result: number;
    if (op === 'avg') result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    else if (op === 'min') result = nums.length ? Math.min(...nums) : 0;
    else if (op === 'max') result = nums.length ? Math.max(...nums) : 0;
    else if (op === 'count') result = nums.length;
    else result = nums.reduce((a, b) => a + b, 0);
    return { output: String(result) };
  },

  'table-aggregator': ({ node, inputText }) => {
    // `merge`'s 'array' strategy, filtered to rows that actually parsed as an
    // object — Make's Table aggregator collects structured rows, not a mix
    // of scalars and objects.
    const rows = fanInParts(node, inputText)
      .map((p) => { try { return JSON.parse(p) as unknown; } catch { return null; } })
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
    return { output: JSON.stringify(rows) };
  },

  'text-aggregator': ({ node, inputText }) => {
    const separator = typeof node.config.separator === 'string' ? node.config.separator : '\n';
    return { output: fanInParts(node, inputText).join(separator) };
  },

  'compose-string': ({ node, inputText }) =>
    ({ output: renderTemplate(typeof node.config.template === 'string' ? node.config.template : '{{input}}', inputText) }),

  'convert-encoding': ({ node, inputText }) => {
    const mode = typeof node.config.mode === 'string' ? node.config.mode : 'base64-encode';
    return { output: convertEncoding(mode, inputText) };
  },

  'regex-match': ({ node, inputText }) => {
    const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
    const flags = typeof node.config.flags === 'string' ? node.config.flags : '';
    return { output: JSON.stringify(regexMatch(pattern, flags, inputText)) };
  },

  'html-to-text': ({ inputText }) => ({ output: htmlToText(inputText) }),

  'html-table': ({ inputText }) => ({ output: JSON.stringify(htmlTable(inputText)) }),

  'html-elements': ({ node, inputText }) => {
    const tag = typeof node.config.tag === 'string' ? node.config.tag : '';
    return { output: JSON.stringify(htmlElements(inputText, tag)) };
  },

  'match-elements': ({ node, inputText }) => {
    const tag = typeof node.config.tag === 'string' ? node.config.tag : '';
    const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
    return { output: JSON.stringify(matchElements(inputText, tag, pattern)) };
  },

  'match-pattern-advanced': ({ node, inputText }) => {
    const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
    const flags = typeof node.config.flags === 'string' ? node.config.flags : '';
    return { output: JSON.stringify(matchPatternAdvanced(pattern, flags, inputText)) };
  },

  replace: ({ node, inputText }) => {
    const pattern = typeof node.config.pattern === 'string' ? node.config.pattern : '';
    const replacement = typeof node.config.replacement === 'string' ? node.config.replacement : '';
    const flags = typeof node.config.flags === 'string' ? node.config.flags : '';
    const literal = node.config.literal === true || node.config.literal === 'true';
    return { output: replaceText(inputText, pattern, replacement, flags, literal) };
  },

  'chunk-text': ({ node, inputText }) => {
    const chunkSize = typeof node.config.chunkSize === 'number' ? node.config.chunkSize : Number(node.config.chunkSize) || 1000;
    const overlap = typeof node.config.overlap === 'number' ? node.config.overlap : Number(node.config.overlap) || 0;
    return { output: JSON.stringify(chunkText(inputText, chunkSize, overlap)) };
  },
};
