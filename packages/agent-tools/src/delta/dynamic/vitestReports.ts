/**
 * delta/dynamic/vitestReports.ts — the two vitest reports the dynamic tier reads, as plain maps (pure):
 *
 *  - `vitest bench --run --outputJson <file>`: one value per benchmark (its median, else mean, in ms), keyed
 *    `<root-relative file>#<group full name>#<bench name>` — one round of an interleaved pair;
 *  - `vitest --reporter=json --outputFile <file>`: one duration per test (ms), keyed
 *    `<root-relative file>#<full test name>` — the C6.2 test-timing proxy.
 *
 * Paths are relativized against the tree the run happened in, so the before and after trees key alike.
 */

import { relPath } from '../adapters/analyzer.js';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const nonFinite = (v: unknown): number | undefined => (typeof v === 'number' && !Number.isFinite(v) ? v : undefined);

/** Benchmark key → ms per iteration. Undefined when the value is not a vitest bench report. */
export function benchValues(json: unknown, root: string): Map<string, number> | undefined {
  if (!isRecord(json) || !Array.isArray(json.files)) return undefined;
  const out = new Map<string, number>();
  for (const file of json.files) {
    if (!isRecord(file) || typeof file.filepath !== 'string') continue;
    const path = relPath(root, file.filepath);
    for (const group of list(file.groups)) {
      if (!isRecord(group)) continue;
      const groupName = typeof group.fullName === 'string' ? group.fullName : '';
      for (const b of list(group.benchmarks)) {
        if (!isRecord(b) || typeof b.name !== 'string') continue;
        // A non-finite value (`1e999` parses to Infinity) is KEPT: the runner reports it `non-finite-samples`, never a pass.
        const v = num(b.median) ?? num(b.mean) ?? nonFinite(b.median) ?? nonFinite(b.mean);
        if (v !== undefined) out.set(`${path}#${groupName}#${b.name}`, v);
      }
    }
  }
  return out;
}

/** Test key → duration in ms (passed and failed tests; skipped ones have none). Undefined when not a vitest JSON report. */
export function testDurations(json: unknown, root: string): Map<string, number> | undefined {
  if (!isRecord(json) || !Array.isArray(json.testResults)) return undefined;
  const out = new Map<string, number>();
  for (const file of json.testResults) {
    if (!isRecord(file) || typeof file.name !== 'string') continue;
    const path = relPath(root, file.name);
    for (const t of list(file.assertionResults)) {
      if (!isRecord(t)) continue;
      const name = typeof t.fullName === 'string' ? t.fullName : typeof t.title === 'string' ? t.title : undefined;
      const ms = num(t.duration);
      if (name !== undefined && ms !== undefined) out.set(`${path}#${name}`, ms);
    }
  }
  return out;
}
