#!/usr/bin/env node
/**
 * Post-deploy hook — tells the API a new frontend version is live so it can fan
 * out an OS-level Web Push to every opted-in browser. Runs at the end of
 * `cf-deploy`, after `wrangler deploy` succeeds.
 *
 * Best-effort: a missing secret (local builds) or a failed call NEVER fails the
 * deploy — it just logs and exits 0.
 *
 * Env:
 *   DEPLOY_NOTIFY_SECRET    shared secret matching the API's DEPLOY_NOTIFY_SECRET (required to fire)
 *   DEPLOY_NOTIFY_API_URL   API base (default https://api.builderforce.ai)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));

const secret = process.env.DEPLOY_NOTIFY_SECRET;
const apiUrl = process.env.DEPLOY_NOTIFY_API_URL || 'https://api.builderforce.ai';

if (!secret) {
  console.log('[notify-deploy] DEPLOY_NOTIFY_SECRET not set — skipping push fan-out.');
  process.exit(0);
}

try {
  const res = await fetch(`${apiUrl}/api/push/notify-deploy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, url: 'https://builderforce.ai' }),
  });
  const text = await res.text();
  console.log(`[notify-deploy] ${res.status} ${text}`);
} catch (err) {
  console.warn('[notify-deploy] push fan-out failed (non-fatal):', err?.message ?? err);
}
process.exit(0);
