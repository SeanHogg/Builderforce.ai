#!/usr/bin/env node
/**
 * Reproducible autonomy baseline (AE-01): fully-autonomous ticket completion and
 * autonomous-trigger success, read from the production `GET /api/insights/autonomy`
 * (manager role). Prints a BASELINES.md row, then the result as JSON.
 *
 *   BF_API_TOKEN=<manager token> node api/scripts/measure-autonomy-baseline.mjs --days 30 [--project 12]
 *
 * `BF_API_BASE` may override the host, https only. The token is read from the
 * environment only and is never put in the URL or printed.
 * Exit: 0 ok, 1 request failed / `triggers` missing, 2 bad input.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DEFAULT_BASE = 'https://builderforce.ai';
const TOP_CLASSES = 5;

const argv = process.argv.slice(2);
const flag = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : null; };

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const at = text.indexOf('=');
    if (at < 1) continue;
    const key = text.slice(0, at).trim();
    const value = text.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

function intFlag(name, fallback, min, max) {
  const raw = flag(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) fail(2, `${name} must be an integer ${min}-${max}`);
  return value;
}

function resolveBase() {
  const raw = process.env.BF_API_BASE;
  if (!raw) return DEFAULT_BASE;
  let url;
  try { url = new URL(raw); } catch { return fail(2, 'BF_API_BASE is not a valid URL'); }
  if (url.protocol !== 'https:') fail(2, 'BF_API_BASE must be an https URL');
  return url.origin;
}

const pct = (n) => (n == null ? 'n/a' : `${(n * 100).toFixed(2)}%`);

function commit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

loadDotEnv('.env');
const token = process.env.BF_API_TOKEN;
if (!token) fail(2, 'BF_API_TOKEN is required (a manager-role API token for the production tenant).');

const days = intFlag('--days', 30, 1, 365);
const project = intFlag('--project', null, 1, Number.MAX_SAFE_INTEGER);
const base = resolveBase();

const query = new URLSearchParams({ days: String(days) });
if (project != null) query.set('projectId', String(project));

const response = await fetch(`${base}/api/insights/autonomy?${query}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});
if (!response.ok) fail(1, `GET /api/insights/autonomy failed: HTTP ${response.status}`);
const summary = await response.json();
if (!summary?.triggers) fail(1, 'Response has no `triggers` — the API has not deployed the trigger stats yet.');

const { totals, triggers, truncated } = summary;
const fullyAutonomous = totals.tickets > 0 ? totals.fullyAutonomous / totals.tickets : null;
const topClasses = triggers.byErrorClass.slice(0, TOP_CLASSES).map((c) => `${c.errorClass}=${c.count}`).join(', ') || 'none';

console.log('| Metric | Value | Window | Truncated | Date | Commit |');
console.log('| --- | --- | --- | --- | --- | --- |');
console.log(`| Fully autonomous | ${pct(fullyAutonomous)} (${totals.fullyAutonomous}/${totals.tickets}) | ${days}d | ${truncated} | ${new Date().toISOString().slice(0, 10)} | ${commit()} |`);
console.log(`| Trigger success (upper bound) | ${pct(triggers.successRate)}; error states ${triggers.errorStates}; top: ${topClasses} | ${days}d | ${truncated} | ${new Date().toISOString().slice(0, 10)} | ${commit()} |`);
console.log(JSON.stringify(summary, null, 2));
