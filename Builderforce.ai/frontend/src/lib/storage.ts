// Browser Storage Utilities
// Provides LocalStorage wrappers for chat titles to survive refresh/device logins

const STORAGE_KEY = 'builderforce_chat_titles_v1';

export interface TitleEntry {
  chatId: string;
  title: string;
  updatedAt: number;
}

/**
 * Get all title entries from LocalStorage
 */
export function loadTitleEntries(): Map<string, TitleEntry> {
  if (typeof window === 'undefined') {
    return new Map();
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const entries: TitleEntry[] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/**
 * Save a single title entry to LocalStorage
 */
export function saveTitleEntry(chatId: string, title: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const entries = loadTitleEntries();
  entries.set(chatId, {
    chatId,
    title,
    updatedAt: Date.now(),
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(entries.entries())));
  } catch (error) {
    console.error('Failed to save chat title to LocalStorage:', error);
  }
}

/**
 * Save multiple title entries to LocalStorage
 */
export function saveTitleEntries(entries: Map<string, TitleEntry>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(entries.entries())));
  } catch (error) {
    console.error('Failed to save chat titles to LocalStorage:', error);
  }
}

/**
 * Get a specific title from LocalStorage, or null if not found
 */
export function loadTitle(chatId: string): string | null {
  const entries = loadTitleEntries();
  const entry = entries.get(chatId);
  return entry ? entry.title : null;
}

/**
 * Clear all chat titles from LocalStorage
 */
export function clearTitleEntries(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear chat titles from LocalStorage:', error);
  }
}

/**
 * Prune stale title entries (optional cleanup)
 */
export function pruneStaleEntries(maxAgeMs: number = 14 * 24 * 60 * 60 * 1000): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const entries: TitleEntry[] = JSON.parse(raw);
    const now = Date.now();
    const filtered = entries.filter(entry => now - entry.updatedAt < maxAgeMs);

    if (filtered.length !== entries.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch (error) {
    console.error('Failed to prune stale title entries:', error);
  }
}