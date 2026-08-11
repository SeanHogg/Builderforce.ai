const STOP = new Set('a an and are as at be been by for from had has have he her hers him his i in is it its of on or our she that the their them they this to was we were will with you your'.split(' '));

function stem(term: string): string {
  if (term.length > 5 && term.endsWith('ing')) return term.slice(0, -3);
  if (term.length > 4 && (term.endsWith('ied') || term.endsWith('ies'))) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith('ed')) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith('es')) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) ?? [])
    .filter((term) => !STOP.has(term))
    .map(stem)
    .filter((term) => term.length <= 128);
}

export function termFrequencies(text: string): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const term of tokenize(text)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  return frequencies;
}

export interface LexicalCandidate {
  id: string; title: string | null; text: string; headings: string[]; wordCount: number;
  publishedAt: Date | null; crawledAt: Date; domain: string; canonicalUrl: string; language: string | null;
  terms: Array<{ term: string; titleFrequency: number; headingFrequency: number; bodyFrequency: number; documentFrequency: number }>;
}

export interface RankedCandidate extends LexicalCandidate {
  score: number;
  scoring: { bm25: number; phrase: number; freshness: number; https: number; duplicatePenalty: number };
}

/** Transparent BM25F-style ranking. Field frequency is combined before saturation. */
export function rankLexical(query: string, candidates: LexicalCandidate[], documentCount: number, averageLength: number, now = new Date()): RankedCandidate[] {
  const queryTerms = new Set(tokenize(query));
  return candidates.map((candidate) => {
    let bm25 = 0;
    const lengthNorm = 1 - 0.75 + 0.75 * Math.max(1, candidate.wordCount) / Math.max(1, averageLength);
    for (const stat of candidate.terms) {
      if (!queryTerms.has(stat.term)) continue;
      const frequency = stat.titleFrequency * 3.5 + stat.headingFrequency * 2 + stat.bodyFrequency;
      const idf = Math.log(1 + (Math.max(documentCount, 1) - stat.documentFrequency + 0.5) / (stat.documentFrequency + 0.5));
      bm25 += idf * (frequency * 2.2) / (frequency + 1.2 * lengthNorm);
    }
    const phraseNeedle = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const phrase = phraseNeedle.length > 2 && `${candidate.title ?? ''} ${candidate.headings.join(' ')} ${candidate.text}`.toLowerCase().includes(phraseNeedle) ? 0.75 : 0;
    const reference = candidate.publishedAt ?? candidate.crawledAt;
    const ageDays = Math.max(0, (now.getTime() - reference.getTime()) / 86_400_000);
    const freshness = 0.35 * Math.exp(-ageDays / 180);
    const https = candidate.canonicalUrl.startsWith('https://') ? 0.05 : 0;
    const duplicatePenalty = 0;
    const score = bm25 + phrase + freshness + https - duplicatePenalty;
    return { ...candidate, score, scoring: { bm25, phrase, freshness, https, duplicatePenalty } };
  }).sort((a, b) => b.score - a.score);
}

export function makeSnippet(text: string, query: string, maxLength = 360): string {
  const terms = tokenize(query);
  const lower = text.toLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, center - Math.floor(maxLength / 3));
  const snippet = text.slice(start, start + maxLength).trim();
  return `${start ? '…' : ''}${snippet}${start + maxLength < text.length ? '…' : ''}`;
}
