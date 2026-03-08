#!/usr/bin/env node
/**
 * Push secrets from api/.env to Cloudflare Worker.
 * Usage: npm run secrets:from-env
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function loadDotEnv(path) {
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  } catch (e) {
    console.error('Could not read .env:', e.message);
    process.exit(1);
  }
}

loadDotEnv(join(root, '.env'));

const SECRET_KEYS = ['NEON_DATABASE_URL', 'JWT_SECRET', 'OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_PRO'];

for (const key of SECRET_KEYS) {
  const value = process.env[key];
  if (!value || !value.trim()) continue;
  spawnSync('npx', ['wrangler', 'secret', 'put', key], {
    cwd: root,
    stdio: ['pipe', 'inherit', 'inherit'],
    input: value,
    encoding: 'utf8',
  });
}
