import type { CanvasResumeDocument } from './canvasResume';

export type ResumeBulletLocation = { section: 'work' | 'volunteer' | 'projects'; entryIndex: number; bulletIndex: number };
export type ResumeBulletSuggestion = { id: string; keep: ResumeBulletLocation; remove: ResumeBulletLocation[]; bullet: string; duplicates: string[] };

const words = (value: string) => new Set(value.toLowerCase().replace(/[^\p{L}\p{N}%$]+/gu, ' ').split(/\s+/)
  .filter((word) => word.length > 2).map((word) => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word));
const similarity = (a: string, b: string): number => {
  const left = words(a); const right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
};

function bullets(document: CanvasResumeDocument): Array<{ location: ResumeBulletLocation; text: string }> {
  const result: Array<{ location: ResumeBulletLocation; text: string }> = [];
  for (const section of ['work', 'volunteer', 'projects'] as const) {
    const rows = Array.isArray(document[section]) ? document[section] as Array<Record<string, unknown>> : [];
    rows.forEach((row, entryIndex) => {
      const highlights = Array.isArray(row.highlights) ? row.highlights : [];
      highlights.forEach((text, bulletIndex) => { if (typeof text === 'string' && text.trim()) result.push({ location: { section, entryIndex, bulletIndex }, text: text.trim() }); });
    });
  }
  return result;
}

export function suggestResumeBulletConsolidation(document: CanvasResumeDocument): ResumeBulletSuggestion[] {
  const rows = bullets(document); const used = new Set<number>(); const suggestions: ResumeBulletSuggestion[] = [];
  rows.forEach((candidate, index) => {
    if (used.has(index)) return;
    const matches = rows.map((row, rowIndex) => ({ row, rowIndex })).filter(({ row, rowIndex }) => rowIndex > index && !used.has(rowIndex) && similarity(candidate.text, row.text) >= 0.6);
    if (!matches.length) return;
    matches.forEach(({ rowIndex }) => used.add(rowIndex));
    suggestions.push({ id: `${candidate.location.section}-${candidate.location.entryIndex}-${candidate.location.bulletIndex}`, keep: candidate.location, remove: matches.map(({ row }) => row.location), bullet: candidate.text, duplicates: matches.map(({ row }) => row.text) });
  });
  return suggestions;
}

export function applyResumeBulletConsolidation(document: CanvasResumeDocument, selected: readonly ResumeBulletSuggestion[]): CanvasResumeDocument {
  const next = structuredClone(document);
  const removals = new Map<string, Set<number>>();
  for (const suggestion of selected) for (const location of suggestion.remove) {
    const key = `${location.section}:${location.entryIndex}`;
    const indexes = removals.get(key) ?? new Set<number>(); indexes.add(location.bulletIndex); removals.set(key, indexes);
  }
  for (const [key, indexes] of removals) {
    const [section, rawEntry] = key.split(':') as [ResumeBulletLocation['section'], string];
    const row = (next[section] as Array<Record<string, unknown>> | undefined)?.[Number(rawEntry)];
    if (row && Array.isArray(row.highlights)) row.highlights = row.highlights.filter((_bullet, index) => !indexes.has(index));
  }
  return next;
}
