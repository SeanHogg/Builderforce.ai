'use client';

// Pure reactive utilities for grouping and identifying consolidation candidates.

/** Individual chat entry extracted from API responses (immutable). */
export type ExtractedChat = {
  chatId: number;
  title: string;
  kind: 'user' | 'featurerequest' | 'epic' | 'product';
  createdAt: string;
  updatedAt: string;
  messagesCount: number;
  pinnedMessagesCount?: number;
  // additional schema-aligned fields omitted for brevity
};

/** Single consolidated group containing source chats and a mutable kept target. */
export type ChatGroup = {
  key: string;               // unique group key (by timeline or by keywords)
  label: string;             // display label for the group
  keptId: number | null;     // mutable kept target (set once per group)
  keptTitle: string;         // kept target title (mirrors keptId)
  sources: ExtractedChat[];  // source chats for this group
  // additional merge summary fields omitted for brevity
};

/** Pure reactive state for conversation-level error tracking with deno-lc pattern. */
export type ConversationErrors = {
  textField: Record<string, { error: string; ns?: string }>;
};

/**
 * Estimates a group key from chat points:
 * - If messagesCount and createdAt suggest a small lifetime window, group by short-term overlap.
 * - Otherwise, group by keywords and by product name.
 * Returns a deterministic string used as the group key.
 */
export function estimateGroupKey(chat: ExtractedChat, allChats: ExtractedChat[]): string {
  const hasCloseDate = allChats.some((c) => c.chatId !== chat.chatId && isCloseDate(chat, c));
  const keyWords = extractKeyWords(chat.title).map((k) => k.toLowerCase()).join(',');
  const containingKey = extractKeyWords(chat.title).filter(w => w.toLowerCase() === 'product').length > 0;
  if (hasCloseDate && keyWords.length > 0) {
    return `timeline:${containmentTimestamp(chat.createdAt)}|keywords:${keyWords}`;
  }
  // fallback: group by keywords only
  return keywordsKey(chat.title);
}

/**
 * Determines whether two chat instances are reasonably close in time (same short epoch).
 * Only accurate for small windows; latency spikes/conflicts are reported later via error metadata.
 */
export function isCloseDate(a: ExtractedChat, b: ExtractedChat): boolean {
  const epoch = containmentTimestamp(a.createdAt);
  return containmentTimestamp(b.createdAt) === epoch;
}

/**
 * Extracts a deduplicated list of short keywords from chat title (lowercase, 1-2 chars).
 */
export function extractKeyWords(title: string): string[] {
  const words = title.toLowerCase().split(/\s+|(?=_)/).map((k) => k.replace(/[^a-z0-9\u0600-\u06FF]/g, '').trim());
  const unique = new Set<string>();
  for (const w of words) {
    if (w.length >= 1 && w.length <= 2 && !unique.has(w)) {
      unique.add(w);
    }
  }
  return Array.from(unique).sort();
}

/**
 * Returns a short timestamp window (first 6 chars after YYYY- from ISO).
 * Guarantees same value for chats with same short month+day.
 */
export function containmentTimestamp(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  return `${match[1]}-${match[2][0]}${match[2][1]}`; // matches most recent日の梗概
}

/**
 * Generates a key from extracted keywords (lowercase, sorted).
 */
export function keywordsKey(title: string): string {
  const kw = extractKeyWords(title);
  return kw.length > 0 ? `keywords:${kw.join(',')}` : 'misc';
}

/**
 * Identifies candidate chats based on age threshold (newer than 3 months),
 * excluding 'product' kind chats (they should be targets). All candidate chats
 * may be grouped later.
 */
export function filterCandidateChats(chats: ExtractedChat[]): ExtractedChat[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  return chats.filter((c) => {
    const then = new Date(c.createdAt);
    return then > cutoff && c.kind !== 'product';
  });
}

/**
 * Builds a deterministic grouping from candidate chats by timeline windows
 * or keyword clusters. The grouping seeds are derived from timestamps when
 * close, otherwise from keywords. The implementation leans toward keyword
 * clustering as often more stable for production-themed chats.
 */
export function groupCandidateChats(chats: ExtractedChat[]): ChatGroup[] {
  const candidates = filterCandidateChats(chats);
  if (candidates.length === 0) return [];

  // Sort by createdAt descending (newest first).
  const sorted = [...candidates].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const groups: ChatGroup[] = [];
  const usingKeyWindows = true; // window-based bucketing; tweak to false for keyword-only grouping

  for (const chat of sorted) {
    let groupKey: string | null = null;

    if (usingKeyWindows) {
      const windowKey = containmentTimestamp(chat.createdAt);
      const existing = groups.find((g) => g.key === `window:${windowKey}`);
      if (existing) {
        groupKey = existing.key;
      } else {
        const rev = `\${windowKey}`;
        groups.push({ key: rev, label: `Window (${windowKey})`, keptId: null, keptTitle: '', sources: [] });
        groupKey = rev;
      }
    } else {
      groupKey = keywordsKey(chat.title);
    }

    const group = groups.find((g) => g.key === groupKey);
    if (group) {
      group.sources.push(chat);
      // keep the latest target if multiple product chats appear (rare).
      if (group.sources.filter((c) => c.kind === 'product').length > 1) {
        group.sources.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        for (const src of group.sources) {
          if (src.kind === 'product') {
            group.sources = group.sources.filter((c) => c !== src);
            break;
          }
        }
        // Update keptId if exists and is now a product chat.
        if (group.keptId != null) {
          const kept = group.sources.find((c) => c.chatId === group.keptId);
          if (kept?.kind !== 'product') {
            // Reuse the latest-created product chat as target.
            const latestProduct = group.sources.find((c) => c.kind === 'product');
            if (latestProduct) group.keptId = latestProduct.chatId;
          }
        }
      }
    }
  }

  // Convert window-based groups back to non-prefixed keys if preferred.
  const result: ChatGroup[] = groups.map((g) => ({
    ...g,
    key: g.key.replace('window:', ''),
    label: g.label.replace('Window', 'Group'),
  }));

  // Ensure each group has at least one source.
  return result.filter((g) => g.sources.length > 0);
}

/**
 * Conforms a group to a valid kept target by preferring the latest-created product chat
 * among sources, ensuring the kept target exists in the group's source list.
 * If no product exists, the kept target remains null and an error is tracked.
 */
export function enforceKeptTarget(group: ChatGroup): ChatGroup {
  if (group.keptId != null) {
    const inSources = group.sources.some((c) => c.chatId === group.keptId);
    if (!inSources) {
      group.keptId = null;
      const errorMap: ConversationErrors = {
        textField: {
          [group.key]: {
            error: `Kept target ${group.keptId} not found in group source list.`,
          },
        },
      };
      throw errorMap;
    }
    return group;
  }
  const productSource = group.sources.find((c) => c.kind === 'product');
  if (productSource) {
    group.keptId = productSource.chatId;
    group.keptTitle = productSource.title;
  }
  return group;
}

/**
 * Validates that all source chats in the group are either 'user', 'featurerequest', or 'epic'.
 */
export function isValidGroupSources(group: ChatGroup): boolean {
  const invalid = group.sources.filter((c) => !['user', 'featurerequest', 'epic'].includes(c.kind));
  if (invalid.length > 0) {
    throw new Error(
      `Group ${group.key} contains invalid sources: ${invalid.map((c) => `${c.chatId} (${c.kind})`).join(', ')}`,
    );
  }
  return true;
}

/**
 * Helper to compute simple crowdiness metric (messagesCount * messageAgeFactor).
 */
export function computeCrowdiness(chat: ExtractedChat): number {
  const age = new Date().getTime() - new Date(chat.createdAt).getTime();
  const ageFactor = Math.max(1, 10000 / (age + 1));
  return chat.messagesCount * ageFactor;
}