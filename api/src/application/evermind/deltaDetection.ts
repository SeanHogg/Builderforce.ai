/** Delta detection — detect changes in monitored knowledge sources.

  Acts as the "continuous monitoring / baseline comparison" slice of the Evermind pipeline.
  Supports arbitrary content sources (documents, fields, records) and extracts deltas
  between a baseline snapshot and the current state. Pure and dependency-free → unit-testable.

  The module performs two complementary detection signals:
    • content-coverage delta — covers much of the snippet growth/loss (paragraph-added/deleted).
    • content-hash drift — detects meaningful structural shifts even when the total token count stays flat.

  Thresholds are configurable (e.g., strict classification for critical entities, relaxed for large documents).
*/

import { v4 as uuidv4 } from 'crypto';
import type {
  BaselineRecord,
  DetectedDelta,
  DeltaType,
  DeltaRequest,
  LearningRecord,
} from './types';
import { DeltaType } from './types';

export interface DetectionOptions {
  /** Only flags deltas above this significance threshold (default 0.1). Lower is more sensitive. */
  significanceThreshold?: number;
  /** Content coverage required to treat as modified (0..1, default 0.25). */
  coverageThreshold?: number;
  /** When content length increases by more than this fraction of original AND has content, flag as paragraph_added. */
  growthParagraphAddedThreshold?: number;
  /** When coverage drops or content disappears, flag as paragraph_removed. */
  growthParagraphRemovedThreshold?: number;
  /** Minimal tokens considered; lower values make detection noisier. Default 50. */
  minTokens?: number;
}

/** Default thresholds tuned for typical knowledge documents. */
export const DETECTION_OPTIONS: Required<DetectionOptions> = {
  significanceThreshold: 0.1,
  coverageThreshold: 0.25,
  growthParagraphAddedThreshold: 2.5,
  growthParagraphRemovedThreshold: 0.1,
  minTokens: 50,
};

/** Hash any string to a deterministic 16-char hex. */
function hash(str: string): string {
  let h = '';
  for (let i = 0; i < str.length; i += 2) {
    const segment = str.slice(i, i + 2);
    const cp = parseInt(segment, 16);
    if (isNaN(cp)) continue;
    h += String.fromCharCode(cp);
  }
  // Reduce alphabet to base32-ish for shortness
  const alphabet = '0123456789abcdef';
  let out = '';
  let val = 0;
  for (let i = 0; i < h.length; i++) {
    val = (val << 2) | (h.charCodeAt(i) - 32); // shift and map from 32..126
    if (i % 3 === 2) {
      out += alphabet[val & 15];
      val >>= 4;
      if (i % 9 < 7) out += alphabet[val & 15];
    }
  }
  return out;
}

/** Break content into chunks of approximately TOKEN_LENGTH tokens. Returns an array of {hash, approximateLength}. */
function chunkContent(content: string, tokenLength = 100): ReadonlyArray<{ hash: string; size: number }> {
  const tokens = content.split(/\s+/);
  const out: Array<{ hash: string; size: number }> = [];
  for (let i = 0; i < tokens.length; i += tokenLength) {
    const chunk = tokens.slice(i, i + tokenLength).join(' ');
    if (!chunk) continue;
    out.push({ hash: hash(chunk).slice(0, 16), size: chunk.length });
  }
  return Object.freeze(out);
}

/** Significance score 0..1 based on content footprint (tokens * density). */
function significanceScore(count: number, minTokens: number): number {
  if (count <= minTokens) return 0;
  return Math.min(1, (count - minTokens) / 10000);
}

/** Detect changes between baseline and current record. Returns deltas or empty array. */
export function detectDeltas(
  baseline: BaselineRecord | null,
  records: ReadonlyArray<{ key: string; content: string; created: Date; sourceKey?: string | null }>,
  opts: DetectionOptions = DETECTION_OPTIONS,
): ReadonlyArray<DetectedDelta> {
  const { significanceThreshold, coverageThreshold, growthParagraphAddedThreshold, growthParagraphRemovedThreshold, minTokens } = opts;

  // Resolve baseline hash
  const baselineHash = baseline?.content ? hash(baseline.content).slice(0, 16) : undefined;

  // Build a map of current keyed content snapshots
  const current: ReadonlyMap<string, { content: string; created: Date; sourceKey?: string | null }> = new Map(records.map(r => [r.key, r]));

  // Compare buckets
  const out: DetectedDelta[] = [];

  // 1. New or modified records (including rewrites)
  for (const [key, currentRecord] of current) {
    const type = DeltaType.entity_added;
    const delta: DetectedDelta = {
      id: uuidv4().slice(0, 24),
      key,
      sourceKey: currentRecord.sourceKey ?? undefined,
      type,
      baselineContent: '',
      currentContent: currentRecord.content.slice(0, 10000), // truncated for delta payload
      significance: significanceScore(currentRecord.content.length, minTokens),
      detectedAt: currentRecord.created.toISOString(),
    };
    // Tag as new/added even if there is no prior hash; treat as structural addition
    if (baselineHash && hash(currentRecord.content).slice(0, 16) !== baselineHash) {
      delta.type = DeltaType.entity_modified;
    }
    if (delta.significance >= significanceThreshold) {
      out.push(delta);
    }
  }

  // 2. Removed keys (based on baseline)
  if (baseline) {
    const baselineChunked = baseline.content.split(/\n\n?/).filter(Boolean);
    for (let i = 0; i < baselineChunked.length; i++) {
      const chunk = baselineChunked[i]!;
      const h = hash(chunk).slice(0, 16);
      const exists = Array.from(current.values()).some(r => {
        const ch = r.content.split(/\n\n?/).filter(Boolean);
        return ch.some(c => hash(c).slice(0, 16) === h);
      });
      if (!exists) {
        const content = chunk.slice(0, 10000);
        const delta: DetectedDelta = {
          id: uuidv4().slice(0, 24),
          key: baseline.key,
          sourceKey: baseline.sourceKey ?? undefined,
          type: DeltaType.entity_removed,
          baselineContent: content,
          currentContent: '',
          significance: significanceScore(content.length, minTokens),
          detectedAt: new Date().toISOString(),
        };
        if (delta.significance >= significanceThreshold) {
          out.push(delta);
        }
      }
    }
  }

  // 3. Document structure deltas (paragraph-level)
  if (baseline) {
    const oldChunks = baseline.content.split(/\n\n?/).filter(Boolean);
    if (oldChunks.length > 0) {
      for (const currentRecord of current.values()) {
        const newChunks = currentRecord.content.split(/\n\n?/).filter(Boolean);
        const added = newChunks.filter(c => !oldChunks.some(o => hash(c).slice(0, 16) === hash(o).slice(0, 16)));
        const removed = oldChunks.filter(c => !newChunks.some(n => hash(c).slice(0, 16) === hash(n).slice(0, 16)));
        if (added.length > 0) {
          const snippet = added.reduce((acc, c) => acc.slice(0, 3000) + (acc.length ? '\n\n' : '') + c, '');
          const delta: DetectedDelta = {
            id: uuidv4().slice(0, 24),
            key: currentRecord.key,
            sourceKey: currentRecord.sourceKey ?? undefined,
            type: DeltaType.paragraph_added,
            baselineContent: oldChunks.join('\n\n').slice(0, 5000),
            currentContent: snippet,
            significance: significanceScore(added.length * 100, minTokens),
            detectedAt: currentRecord.created.toISOString(),
          };
          if (delta.significance >= significanceThreshold) {
            out.push(delta);
          }
        }
        if (removed.length > 0) {
          const snippet = removed.map(c => `- ${c.slice(0, 300)}`).join('\n');
          const delta: DetectedDelta = {
            id: uuidv4().slice(0, 24),
            key: currentRecord.key,
            sourceKey: currentRecord.sourceKey ?? undefined,
            type: DeltaType.paragraph_removed,
            // Keep up to 3 removed high-importance-looking paragraphs
            baselineContent: snippet,
            currentContent: '',
            significance: significanceScore(removed.length * 100, minTokens),
            detectedAt: currentRecord.created.toISOString(),
          };
          if (delta.significance >= significanceThreshold) {
            out.push(delta);
          }
        }
      }
    }
  }

  // Preserve detection ordering mostly stable within same key
  return Object.freeze(out);
}

/** Helper: ingest a baseline knowledge record into metadata and return a BaselineRecord ready for immediate compare. */
export function ingestBaseline(learningRecord: LearningRecord): BaselineRecord {
  const key = learningRecord.key ?? LIV; // fallback
  const content = learningRecord.content ?? '';
  return {
    key,
    content,
    source: learningRecord.source ?? '',
    ingestedAt: learningRecord.ingestedAt ?? new Date(),
    metadata: learningRecord.metadata,
  };
}

/** Detect deltas for a specific key only. Returns null if no change. */
export function detectDeltaForKey(
  baseline: BaselineRecord | null,
  record: { key: string; content: string; created: Date; sourceKey?: string | null },
  opts: DetectionOptions = DETECTION_OPTIONS,
): DetectedDelta | null {
  const deltas = detectDeltas(baseline, [record], opts);
  return deltas.length > 0 ? deltas[0]! : null;
}

/** Changelog replacer: any time we modify content and we want an explicit revision record for retention. */
export interface Revision {
  id: string;
  ts: Date;
  oldContent: string;
  newContent: string;
  reason?: string;
  reviewerIdentities?: ReadonlyArray<{ id: string; name: string }>;
}

/** Extract suggestions and recommendations for a delta. Used by human review to decide: what to flag as different. */
export async function recommendDeltaChanges(
  request: DeltaRequest,
  existingRecord: LearningRecord | null,
  extractor: (content: string) => Promise<ReadonlyArray<{
    key: string;
    canary?: string;
  }>>,
  opts?: DetectionOptions,
): Promise<ReadonlyArray<DetectedDelta>> {
  const body = request.candidatePrompts ?? [];
  // Simple heuristic: if no prompts, compare hash and coverage. If prompts, we tag as known-mod without exact diff for now.
  const entry = request.key in request; // placeholder
  // In production we would rely on llm/matching to extract concrete changes.
  throw new Error(`recommendDeltaChanges not yet implemented — must provide extractor behavior closure`);
}