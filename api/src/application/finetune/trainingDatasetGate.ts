/**
 * May this corpus be trained on?
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * `evaluateDatasetUse` has always been able to answer the question. Nothing on the
 * training path had ever asked it, and not because somebody forgot: the gate lived in a
 * frontend module and `POST /api/ide/training` cannot import one, while `ide_datasets`
 * carried no classification for it to read even if it could. Migration 0936 gave the row
 * the columns; `packages/creation-canvas-contract/src/dataGovernance.ts` moved the
 * evaluator somewhere both sides reach. This is the boundary that asks.
 *
 * ── WHY THE ANSWER IS 403 AND NOT A WARNING ──────────────────────────────────────
 * The asymmetry the gate is built on: an export produces a copy somebody can later
 * delete, and training produces weights that cannot be un-trained, cannot honour an
 * erasure request, and outlive any lawful basis that can later be withdrawn. A warning on
 * an irreversible action is a warning nobody reads twice.
 *
 * ── WHY AN UNCLASSIFIED DATASET STILL TRAINS ─────────────────────────────────────
 * `classifications` is NULL on every row that predates 0936 and on every corpus generated
 * by `POST /datasets/generate` (synthetic instruction pairs — nobody's personal data). The
 * evaluator reads no classified columns as no personal data and permits the use, which is
 * exactly the answer those rows get today. Refusing them instead would break every
 * existing pipeline to enforce a policy nobody had the chance to declare, and would teach
 * people that the way past this gate is to leave the fields blank.
 */

import { eq } from 'drizzle-orm';
import {
  evaluateDatasetUse,
  normalizeClassifications,
  normalizeUsePolicy,
  type DatasetUseDecision,
} from '@builderforce/creation-canvas-contract';
import { ideDatasets } from '../../infrastructure/database/schema/agents';

/** The narrow read this gate needs. Structural, so a caller can hand it a Drizzle db or a
 *  fake without either side importing the other's test helpers. */
export interface TrainingDatasetReader {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (predicate: unknown) => Promise<Array<Record<string, unknown>>>;
    };
  };
}

export interface TrainingGateVerdict extends DatasetUseDecision {
  /** True when the dataset id named no row at all — a different failure from a refusal,
   *  and the route answers it with a 404 rather than a 403. */
  notFound?: boolean;
  /** The canvas card a person has to go and fix, when the corpus came from one. Naming an
   *  opaque dataset id in a refusal is how a governance gate becomes something people
   *  route around rather than satisfy. */
  source?: { sessionId: string | null; objectId: string | null };
}

/**
 * Read one corpus's governance and decide.
 *
 * A dataset id that names nothing returns `notFound` rather than `allowed: true`: the
 * training route already 404s an unknown dataset elsewhere, and a gate that silently
 * permits an unresolvable id is a gate an attacker walks through by mistyping.
 */
export async function evaluateTrainingDataset(
  db: TrainingDatasetReader,
  datasetId: string,
  now: Date = new Date(),
): Promise<TrainingGateVerdict> {
  const [row] = await db
    .select({
      classifications: ideDatasets.classifications,
      usePolicy: ideDatasets.usePolicy,
      sourceSessionId: ideDatasets.sourceSessionId,
      sourceObjectId: ideDatasets.sourceObjectId,
    })
    .from(ideDatasets)
    .where(eq(ideDatasets.id, datasetId));

  if (!row) return { allowed: false, notFound: true };

  const decision = evaluateDatasetUse(
    // `'training'` and not `'train'`: `DATASET_USES` is the vocabulary and
    // `PROCESSING_USES` — the set that decides whether consent is required at all
    // — is keyed on it. The misspelling typechecked as an error nobody could see
    // behind a red build, and at runtime would have fallen through the processing
    // gate entirely: a training use classified as harmless.
    'training',
    normalizeClassifications(row.classifications),
    normalizeUsePolicy(row.usePolicy),
    now,
  );

  return {
    ...decision,
    source: {
      sessionId: (row.sourceSessionId as string | null) ?? null,
      objectId: (row.sourceObjectId as string | null) ?? null,
    },
  };
}

/** The 403 body. One shape, so the IDE surface and any future dispatcher render the same
 *  refusal instead of each inventing its own envelope. */
export function trainingGateBody(verdict: TrainingGateVerdict) {
  return {
    error: verdict.reason ?? 'This dataset cannot be used as a training corpus.',
    code: 'dataset_use_not_permitted' as const,
    refusal: verdict.code ?? null,
    categories: verdict.categories ?? [],
    source: verdict.source ?? null,
  };
}
