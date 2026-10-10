/**
 * Recipient lists as a person types them — one control's parsing rule, kept
 * pure so the form and its tests read the same answer.
 *
 * People paste lists out of mail clients: commas, semicolons, newlines and
 * `Name <a@b.co>` all arrive. Each entry is reduced to its address, lower-cased,
 * de-duplicated in first-seen order, and anything that is not an address is
 * returned separately so the form can NAME it rather than silently dropping it.
 *
 * No `'use client'`: a data module.
 */

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export interface ParsedRecipients {
  valid: string[];
  invalid: string[];
}

export function parseRecipientInput(text: string): ParsedRecipients {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const entries = text.split(/[,;\n\r]+/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    // `Name <a@b.co>` is ONE entry, display name and all; a bare line may still
    // hold several space-separated addresses.
    if (/<[^>]+>/.test(trimmed)) return [trimmed];
    return trimmed.split(/\s+/);
  });
  for (const entry of entries) {
    const bracketed = entry.match(/<([^>]+)>/);
    const address = (bracketed ? bracketed[1] : entry).trim().toLowerCase();
    if (!ADDRESS.test(address)) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(address)) continue;
    seen.add(address);
    valid.push(address);
  }
  return { valid, invalid };
}

/** The textarea's text for a stored list — one address per line. */
export function formatRecipients(recipients: readonly string[]): string {
  return recipients.join('\n');
}
