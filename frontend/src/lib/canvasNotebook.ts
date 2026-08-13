/**
 * The notebook KERNEL — the cell the canvas never had.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * The `code` kind stored `code`, `language` and `path`: text, with no execution and no
 * output field. Nothing on the board ran a line against a frame and returned a result,
 * so every analysis had to be expressible in the declarative query language or it could
 * not happen at all. The onboarding template made it vivid — it seeded a card titled
 * "Tokenizer & training notebook" with `language: 'python'` that could not execute a
 * cell. A data scientist's core motion is *write code against data and look at the
 * result*, and that motion had nowhere to happen.
 *
 * ── WHY A WORKER, AND WHY NOT `eval` ON THE PAGE ─────────────────────────────────
 * A cell is arbitrary code, frequently written by a model, so `while (true) {}` is not
 * an edge case — it is an expected input. On the main thread that is a hung tab with no
 * recovery: you cannot cooperatively cancel a loop that never yields. In a worker it is
 * a `terminate()` and a typed timeout error. The worker also gets no DOM, no cookies and
 * no `localStorage`, so a cell cannot read the session it is running inside.
 *
 * The worker is created from a Blob URL, which the app's CSP already permits
 * (`script-src … 'unsafe-eval' blob:`). No network is reachable from inside it because
 * `fetch`, `XMLHttpRequest` and `importScripts` are deleted from its global scope before
 * any cell runs — a cell can compute, and cannot exfiltrate.
 *
 * ── WHY THE LAST EXPRESSION IS THE RESULT ────────────────────────────────────────
 * Every REPL a data scientist has ever used works this way, and the alternative — an
 * explicit `return` — is the single most common source of "my cell printed nothing".
 * The source is wrapped so a trailing expression becomes the completion value, with a
 * fall back to plain statement execution when the wrap does not parse (a cell ending in
 * a `for` loop or a function declaration is legal and has no trailing expression).
 *
 * ── WHY `js` AND NOT PYTHON ──────────────────────────────────────────────────────
 * A Python kernel means shipping a ~10MB WebAssembly runtime to every visitor of a
 * public landing canvas, which is a bundle-size and hosting decision rather than an
 * engineering one. `python` and `sql` cells are therefore ACCEPTED, stored, and refused
 * by the kernel with a message naming where they do run (a Builder workspace) — because
 * a refusal the user can act on beats a language the object cannot even express, which
 * is the same argument `CANVAS_IMAGE_ACCOUNT_GATE` makes for images.
 */

import { NOTEBOOK_CELL_TIMEOUT_MS, type NotebookLanguage, type NotebookOutputKind } from '@builderforce/creation-canvas-contract';
import type { TabularSource } from './canvasTabularData';

export interface NotebookCell {
  id: string;
  source: string;
}

export interface NotebookOutput {
  cellId: string;
  kind: NotebookOutputKind;
  /** Short text for the card. The full payload travels in `table`/`chart`/`value`. */
  preview: string;
  /** Present when the cell returned `{columns, rows}`. */
  table?: { columns: string[]; rows: Array<Record<string, string | number>> };
  /** Present when the cell returned `{labels, values}`. */
  chart?: { labels: string[]; values: number[] };
  /** Any other completion value, JSON-safe. */
  value?: unknown;
  error?: string;
  runtimeMs: number;
}

/** How much of a value is worth putting on a card before it stops being readable. */
const PREVIEW_LIMIT = 240;
const MAX_OUTPUT_ROWS = 200;

/**
 * The worker program.
 *
 * A string literal rather than a separate file so it cannot drift from the API it
 * documents, and so no bundler configuration decides whether the kernel exists.
 *
 * The sequence inside matters: the network globals are deleted BEFORE the helper
 * library is installed and before any cell source is compiled, so there is no window in
 * which a cell could capture a reference to `fetch`.
 */
const WORKER_SOURCE = String.raw`
self.fetch = undefined; self.XMLHttpRequest = undefined; self.importScripts = undefined;
self.WebSocket = undefined; self.EventSource = undefined; self.Worker = undefined;

function makeStats() {
  const sorted = (v) => [...v].sort((a, b) => a - b);
  const round = (v) => Number(v.toFixed(6));
  const mean = (v) => v.length ? round(v.reduce((t, x) => t + x, 0) / v.length) : null;
  const percentile = (v, p) => {
    if (!v.length) return null;
    const l = sorted(v);
    if (l.length === 1) return round(l[0]);
    const f = Math.min(1, Math.max(0, p));
    const pos = f * (l.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? round(l[lo]) : round(l[lo] + (l[hi] - l[lo]) * (pos - lo));
  };
  const variance = (v) => {
    if (v.length < 2) return null;
    const m = v.reduce((t, x) => t + x, 0) / v.length;
    return round(v.reduce((t, x) => t + (x - m) ** 2, 0) / (v.length - 1));
  };
  const stddev = (v) => { const s = variance(v); return s == null ? null : round(Math.sqrt(s)); };
  const correlation = (xs, ys) => {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return null;
    const mx = xs.slice(0, n).reduce((t, x) => t + x, 0) / n;
    const my = ys.slice(0, n).reduce((t, y) => t + y, 0) / n;
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    return vx <= 0 || vy <= 0 ? null : round(cov / Math.sqrt(vx * vy));
  };
  const summarize = (v) => {
    if (!v.length) return null;
    const l = sorted(v);
    const q1 = percentile(l, 0.25), q3 = percentile(l, 0.75);
    const iqr = round(q3 - q1);
    return { count: l.length, mean: mean(l), stddev: stddev(l), min: round(l[0]), q1,
      median: percentile(l, 0.5), q3, max: round(l[l.length - 1]), iqr,
      outlierLow: round(q1 - 1.5 * iqr), outlierHigh: round(q3 + 1.5 * iqr) };
  };
  const zScores = (v) => {
    const m = mean(v), s = stddev(v);
    return m == null || s == null || s === 0 ? v.map(() => 0) : v.map((x) => round((x - m) / s));
  };
  const linearFit = (v) => {
    if (v.length < 2) return null;
    const n = v.length;
    const mx = (n - 1) / 2;
    const my = v.reduce((t, x) => t + x, 0) / n;
    let cov = 0, vx = 0;
    for (let i = 0; i < n; i += 1) { cov += (i - mx) * (v[i] - my); vx += (i - mx) ** 2; }
    if (vx <= 0) return null;
    const slope = cov / vx, intercept = my - slope * mx;
    let res = 0, tot = 0;
    for (let i = 0; i < n; i += 1) { res += (v[i] - (intercept + slope * i)) ** 2; tot += (v[i] - my) ** 2; }
    return { slope: round(slope), intercept: round(intercept), r2: tot <= 0 ? 1 : round(Math.max(0, 1 - res / tot)) };
  };
  const histogram = (v, maxBins) => {
    if (!v.length) return [];
    const l = sorted(v), min = l[0], max = l[l.length - 1];
    if (min === max) return [{ start: min, end: max, count: l.length, label: String(round(min)) }];
    const iqr = (percentile(l, 0.75) ?? 0) - (percentile(l, 0.25) ?? 0);
    const width = iqr > 0 ? 2 * iqr / Math.cbrt(l.length) : 0;
    const suggested = width > 0 ? Math.ceil((max - min) / width) : Math.ceil(Math.log2(l.length) + 1);
    const bins = Math.max(1, Math.min(maxBins || 20, suggested));
    const step = (max - min) / bins;
    const out = Array.from({ length: bins }, (_, i) => ({
      start: round(min + i * step), end: round(i === bins - 1 ? max : min + (i + 1) * step), count: 0, label: '',
    }));
    out.forEach((b) => { b.label = b.start + ' – ' + b.end; });
    for (const x of l) out[Math.min(bins - 1, Math.floor((x - min) / step))].count += 1;
    return out;
  };
  const median = (v) => percentile(v, 0.5);
  const mode = (v) => {
    if (!v.length) return null;
    const counts = new Map();
    for (const x of v) counts.set(x, (counts.get(x) || 0) + 1);
    let best = null, bestCount = 0;
    for (const [x, c] of counts) if (c > bestCount || (c === bestCount && best != null && x < best)) { best = x; bestCount = c; }
    return best == null ? null : round(best);
  };
  return { mean, median, percentile, variance, stddev, correlation, summarize, zScores, linearFit, histogram, mode };
}

function makeInfer() {
  const round = (v) => Number(v.toFixed(6));
  const Z = { 0.8: 1.281552, 0.9: 1.644854, 0.95: 1.959964, 0.99: 2.575829 };
  const crit = (l) => Z[l] || Z[0.95];
  const normalCdf = (z) => {
    const sign = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * erf);
  };
  const proportionInterval = (s, n, level) => {
    if (!(n > 0) || s < 0 || s > n) return null;
    const l = level || 0.95, z = crit(l), p = s / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d;
    const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return { low: round(Math.max(0, c - m)), high: round(Math.min(1, c + m)), level: l };
  };
  const meanInterval = (v, level) => {
    if (v.length < 2) return null;
    const l = level || 0.95;
    const m = v.reduce((t, x) => t + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / (v.length - 1));
    const margin = crit(l) * sd / Math.sqrt(v.length);
    return { mean: round(m), sampleSize: v.length, low: round(m - margin), high: round(m + margin), level: l };
  };
  const twoProportionTest = (bs, bn, vs, vn, level) => {
    if (!(bn > 0) || !(vn > 0)) return null;
    const l = level || 0.95, br = bs / bn, vr = vs / vn, lift = vr - br;
    const pooled = (bs + vs) / (bn + vn);
    const pe = Math.sqrt(pooled * (1 - pooled) * (1 / bn + 1 / vn));
    const z = pe > 0 ? lift / pe : 0;
    const p = round(2 * (1 - normalCdf(Math.abs(z))));
    const zc = crit(l);
    const ue = Math.sqrt(br * (1 - br) / bn + vr * (1 - vr) / vn);
    return { baseRate: round(br), variantRate: round(vr), absoluteLift: round(lift),
      relativeLift: br > 0 ? round(lift / br) : null, zScore: round(z), pValue: p,
      interval: { low: round(lift - zc * ue), high: round(lift + zc * ue), level: l },
      significant: p < 1 - l };
  };
  return { normalCdf, proportionInterval, meanInterval, twoProportionTest };
}

self.onmessage = (event) => {
  const { source, frame } = event.data;
  const started = Date.now();
  try {
    const stats = makeStats();
    const infer = makeInfer();
    const df = {
      columns: frame.columns,
      rows: frame.rows,
      get length() { return frame.rows.length; },
      col(name) { return frame.rows.map((r) => r[name]); },
      nums(name) {
        return frame.rows.map((r) => {
          const raw = r[name];
          if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
          if (typeof raw !== 'string') return null;
          const cleaned = raw.trim().replace(/[$£€¥,\s]/g, '').replace(/%$/, '');
          if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(cleaned)) return null;
          const n = Number(cleaned);
          return Number.isFinite(n) ? n : null;
        }).filter((n) => n != null);
      },
      where(fn) { return { columns: frame.columns, rows: frame.rows.filter(fn), col: df.col, nums: df.nums, where: df.where, groupBy: df.groupBy }; },
      groupBy(name) {
        const out = new Map();
        for (const r of frame.rows) {
          const k = String(r[name] ?? '');
          if (!out.has(k)) out.set(k, []);
          out.get(k).push(r);
        }
        return out;
      },
    };
    // The trailing expression is the result. A cell that is pure statements does not
    // parse as a return, so the plain body is run instead and reports undefined —
    // rather than failing with a syntax error the author did not write.
    let fn;
    try { fn = new Function('df', 'stats', 'infer', 'return (' + source + '\n);'); }
    catch { fn = new Function('df', 'stats', 'infer', source); }
    let result;
    try { result = fn(df, stats, infer); }
    catch (inner) {
      // A wrapped expression can compile and then throw for a reason that is really a
      // syntax problem: a cell of pure statements parses as a comma expression and
      // fails at runtime. Retry it as a plain body before reporting the error.
      fn = new Function('df', 'stats', 'infer', source);
      result = fn(df, stats, infer);
    }
    self.postMessage({ ok: true, result, runtimeMs: Date.now() - started });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error && error.message ? error.message : error), runtimeMs: Date.now() - started });
  }
};
`;

/** JSON-safe, bounded rendering of whatever a cell returned. */
function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value.slice(0, PREVIEW_LIMIT);
  try {
    return JSON.stringify(value)?.slice(0, PREVIEW_LIMIT) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Recognise the two shapes that become real canvas artifacts rather than printed text. */
function classify(value: unknown): Pick<NotebookOutput, 'kind' | 'table' | 'chart' | 'value'> {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.columns) && Array.isArray(record.rows)) {
      return {
        kind: 'table',
        table: {
          columns: record.columns.slice(0, 60).map(String),
          rows: (record.rows as Array<Record<string, string | number>>).slice(0, MAX_OUTPUT_ROWS),
        },
      };
    }
    if (Array.isArray(record.labels) && Array.isArray(record.values)) {
      return {
        kind: 'chart',
        chart: {
          labels: record.labels.slice(0, MAX_OUTPUT_ROWS).map(String),
          values: (record.values as unknown[]).slice(0, MAX_OUTPUT_ROWS).map((entry) => Number(entry) || 0),
        },
      };
    }
  }
  return { kind: 'value', value };
}

/**
 * The message a `python` or `sql` cell gets back.
 *
 * It names where the language DOES run rather than saying "unsupported", for the reason
 * the canvas image gate already records: a refusal the model cannot act on becomes an
 * invented limitation reported to the user as a fact about the product.
 */
export function unsupportedLanguageMessage(language: NotebookLanguage): string {
  return language === 'python'
    ? 'This kernel runs JavaScript in the browser, so a Python cell is stored but not executed here. Run Python in a Builder workspace (add a Builder object and choose a type), or rewrite the cell in JavaScript — `df`, `stats` and `infer` cover the profiling, quantiles, correlation and hypothesis tests most cells need.'
    : 'This kernel runs JavaScript in the browser, so a SQL cell is stored but not executed here. Query a connected warehouse with a Data source object, or rewrite the cell in JavaScript — `df.where()`, `df.groupBy()` and `stats` cover grouping and aggregation over the bound rows.';
}

/**
 * Run one cell against a frame.
 *
 * Resolves — never rejects — so one failing cell reports its error into the notebook
 * beside the others rather than aborting the run. A cell that fails is a result.
 */
export function runNotebookCell(
  cell: NotebookCell,
  frame: TabularSource,
  language: NotebookLanguage = 'js',
  timeoutMs: number = NOTEBOOK_CELL_TIMEOUT_MS,
): Promise<NotebookOutput> {
  if (language !== 'js') {
    return Promise.resolve({ cellId: cell.id, kind: 'error', preview: unsupportedLanguageMessage(language), error: unsupportedLanguageMessage(language), runtimeMs: 0 });
  }
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return Promise.resolve({ cellId: cell.id, kind: 'error', preview: 'No kernel available in this environment.', error: 'No kernel available in this environment.', runtimeMs: 0 });
  }
  return new Promise<NotebookOutput>((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let settled = false;
    const finish = (output: NotebookOutput) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(output);
    };
    // Terminate rather than ask: a runaway loop cannot service a cooperative cancel,
    // which is the whole reason the kernel is a worker and not an `eval` on this thread.
    const timer = setTimeout(() => finish({
      cellId: cell.id,
      kind: 'error',
      preview: `Cell stopped after ${timeoutMs} ms.`,
      error: `Cell stopped after ${timeoutMs} ms. It either loops forever or is doing more work than a canvas cell should — move heavy work to a Builder workspace.`,
      runtimeMs: timeoutMs,
    }), timeoutMs);
    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      const data = event.data as { ok: boolean; result?: unknown; error?: string; runtimeMs: number };
      if (!data.ok) {
        finish({ cellId: cell.id, kind: 'error', preview: data.error ?? 'Cell failed.', error: data.error, runtimeMs: data.runtimeMs });
        return;
      }
      finish({ cellId: cell.id, preview: describe(data.result), runtimeMs: data.runtimeMs, ...classify(data.result) });
    };
    worker.onerror = (event: ErrorEvent) => {
      clearTimeout(timer);
      finish({ cellId: cell.id, kind: 'error', preview: event.message || 'Cell failed.', error: event.message || 'Cell failed.', runtimeMs: 0 });
    };
    // Rows are structured-cloned to the worker, so a cell mutating them cannot touch
    // the canvas object they came from.
    worker.postMessage({ source: cell.source, frame: { columns: frame.columns, rows: frame.rows } });
  });
}

/** Run every cell in order. Sequential on purpose: cells are read top-to-bottom and a
 *  reader assumes cell three saw what cell two printed. */
export async function runNotebook(
  cells: readonly NotebookCell[],
  frame: TabularSource,
  language: NotebookLanguage = 'js',
): Promise<NotebookOutput[]> {
  const outputs: NotebookOutput[] = [];
  for (const cell of cells) outputs.push(await runNotebookCell(cell, frame, language));
  return outputs;
}
