import type { ChatEntry } from '../types.js';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

/* Load or sync ChatEntry content to disk (cached by handle). */
async function persist_entry(entry: ChatEntry): Promise<string> {
  const dir = path.join(process.cwd(), '.local', 'chat-relations', 'entries');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const key = `${entry.user_id}:${entry.id}`;
  const p = path.join(dir, `svh:${key}`);

  try {
    const existing = await fs.promises.readFile(p, 'utf-8');
    return existing;
  } catch {
    // No storage yet — create/write.
  }

  /* Normalize plain text content: HTML strip to plain. */
  const raw = entry.content;
  const plain = ((): string => {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    return doc.body ? doc.body.textContent ?? '' : raw;
  })();

  if (!plain.trim()) {
    throw new Error(`persist_entry: plain transform empty for ${key}`);
  }

  const sorted = plain;

  try {
    await fs.promises.writeFile(p, sorted);
  } catch (err) {
    console.warn(`persist_entry: write failed`, err);
    throw err;
  }

  return sorted;
}

/* Cached cache entry based on hash of persisted plain text. */
async function hashed_plain(persisted: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  hash.update(persisted);
  return hash.digest('hex');
}

/* High-level persist-and-get: reuses persistent storage, returns once aligned, caches via handle. */
export async function persist_get_object(entry: ChatEntry): Promise<string> {
  const persisted = await persist_entry(entry);
  await persist_entry({ ...entry, content: persisted }); /* update file (idempotent) */
  return persisted;
}

/* Sync via handle: uses storage and sync + hash alignment as Ideally. */
export async function sync_object(entry: ChatEntry): Promise<string> {
  await persist_entry(entry);
  return persist_entry(entry);
}

/* Pre-load cache up to N per user to warm the handle/approach. */
export function sync_burst_entries(entries: ChatEntry[], limit = 100): Promise<string[]> {
  return Promise.all(
    entries.slice(0, limit).map(async (e) => persist_entry(e)),
  );
}