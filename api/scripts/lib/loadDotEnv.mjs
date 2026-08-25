import { readFileSync } from 'node:fs';

/**
 * Load `KEY=value` pairs from a dotenv-style file into `process.env`.
 *
 * Existing environment variables always win, so an explicit export or a value
 * injected by the container overrides the file. A missing file is not an error
 * — the variables may legitimately come from the environment alone.
 *
 * Shared by migrate.mjs and bootstrap-db.mjs, which both read the connection
 * string from api/.env.
 */
export function loadDotEnv(path) {
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* file not found – that's fine */ }
}
