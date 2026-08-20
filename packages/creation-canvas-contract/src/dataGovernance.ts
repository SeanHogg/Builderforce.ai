/**
 * DATA GOVERNANCE — the classification vocabulary and the use gate, shared.
 *
 * ── WHY THIS MOVED OUT OF THE FRONTEND ───────────────────────────────────────────
 * `frontend/src/lib/canvasDataGovernance.ts` owns two different things that happened to
 * be written on the same day: DETECTION (read a column's name and values, propose a tag)
 * and the POLICY GATE (given the tags and the declared purpose, may this use proceed).
 * Detection is a canvas concern — it reads `TabularSource` and only ever runs where rows
 * are in a browser. The gate is not: the use it most needs to refuse is a FINE-TUNE, and
 * a fine-tune is dispatched by `POST /api/ide/training` in the API, which cannot import a
 * frontend module.
 *
 * The consequence, recorded in the roadmap before this file existed: `evaluateDatasetUse`
 * was written, covered by seventeen tests, consulted by the export path — and structurally
 * unreachable from the one path where an unlawful use cannot be undone. A gate that
 * cannot be asked at the boundary that matters is documentation.
 *
 * So the vocabulary and the gate live HERE, in the contract both sides already depend on,
 * and `canvasDataGovernance.ts` re-exports every symbol so no existing import path
 * changes. Detection, masking and the data-contract evaluator stay where they are: they
 * are canvas code and nothing server-side asks them anything.
 *
 * Not legal advice, and deliberately not a compliance score: it answers ONE question —
 * may this specific use proceed — and refuses when the answer is unknown for the use that
 * cannot be undone, because "nobody filled this in" is exactly the state in which the
 * unsafe thing happens.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Sensitivity ladder, least to most restricted. Order is meaningful — see
 *  {@link highestClassification}. */
export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type DataClassification = typeof DATA_CLASSIFICATIONS[number];

/** What KIND of personal data a column holds. `none` is a real answer, not an
 *  absence: it is how a reviewer records "I looked, and this is not personal". */
export const PII_CATEGORIES = [
  'none', 'name', 'email', 'phone', 'address', 'government_id', 'financial',
  'health', 'credentials', 'location', 'date_of_birth', 'ip_address',
] as const;
export type PiiCategory = typeof PII_CATEGORIES[number];

/** Categories that must never render or export in the clear. */
export const ALWAYS_MASKED: ReadonlySet<PiiCategory> = new Set<PiiCategory>([
  'government_id', 'financial', 'credentials', 'health',
]);

const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  public: 0, internal: 1, confidential: 2, restricted: 3,
};

export function highestClassification(values: readonly DataClassification[]): DataClassification {
  return values.reduce<DataClassification>((winner, value) => CLASSIFICATION_RANK[value] > CLASSIFICATION_RANK[winner] ? value : winner, 'public');
}

export function isDataClassification(value: unknown): value is DataClassification {
  return typeof value === 'string' && (DATA_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function isPiiCategory(value: unknown): value is PiiCategory {
  return typeof value === 'string' && (PII_CATEGORIES as readonly string[]).includes(value);
}

/** The classification a PII category implies when nothing stricter is declared. */
export const PII_CLASSIFICATION: Record<PiiCategory, DataClassification> = {
  none: 'internal',
  name: 'confidential',
  email: 'confidential',
  phone: 'confidential',
  address: 'confidential',
  location: 'confidential',
  date_of_birth: 'restricted',
  government_id: 'restricted',
  financial: 'restricted',
  health: 'restricted',
  credentials: 'restricted',
  ip_address: 'confidential',
};

export type ClassificationConfidence = 'high' | 'medium' | 'low';

export interface ColumnClassification {
  column: string;
  classification: DataClassification;
  pii: PiiCategory;
  confidence: ClassificationConfidence;
  /** Machine-readable reason key. The UI localizes it; nothing here formats prose. */
  reason: 'value-match' | 'name-match' | 'default';
  /** True when the column must be masked wherever it renders. */
  masked: boolean;
}

/**
 * Read classifications previously confirmed onto a canvas object — or, now, stored on an
 * `ide_datasets` row. Unknown values are dropped rather than coerced: a bad tag must not
 * become a confident one, and a corrupted `pii` silently read as `none` would turn a
 * refusal into a permission.
 */
export function normalizeClassifications(value: unknown): ColumnClassification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const column = typeof item.column === 'string' ? item.column.trim() : '';
    if (!column) return [];
    const pii = isPiiCategory(item.pii) ? item.pii : 'none';
    const classification = isDataClassification(item.classification) ? item.classification : PII_CLASSIFICATION[pii];
    const confidence: ClassificationConfidence = item.confidence === 'high' || item.confidence === 'medium' ? item.confidence : 'low';
    const reason: ColumnClassification['reason'] = item.reason === 'value-match' || item.reason === 'name-match' ? item.reason : 'default';
    return [{
      column, classification, pii, confidence, reason,
      masked: typeof item.masked === 'boolean' ? item.masked : ALWAYS_MASKED.has(pii),
    }];
  });
}

// ---------------------------------------------------------------------------
// The use gate
// ---------------------------------------------------------------------------
//
// A classification that describes and never refuses is documentation, and documentation
// does not refuse. The product already models the idea correctly one kind over:
// `battlecard.doNotSay` is a restriction that TRAVELS WITH THE OBJECT and is read at the
// point of composition. This is the same shape for data — a purpose, a lawful basis and a
// retention window authored on the classification, and a gate on the paths that consume
// rows.
//
// Three questions, because the regulation asks three and answering two is answering none:
//   • PURPOSE       what were these rows collected FOR? Using them for something else is
//                   purpose creep, which is the violation that training a model on
//                   support tickets usually is.
//   • LAWFUL BASIS  what makes processing them lawful at all (GDPR Article 6)?
//   • RETENTION     how long may they be kept? An expired dataset is not a dataset with a
//                   warning on it; it is rows that should not exist.

/**
 * What a caller wants to DO with the rows.
 *
 * ── ONE VOCABULARY, AFTER TWO ────────────────────────────────────────────────────
 * This list is the merge of two that shipped a week apart and never met.
 * `dataScience.ts` declared `DATA_PURPOSES` (`analysis`, `training`, `evaluation`,
 * `export`, `sharing`) with a `checkDataUse` the canvas tools call; this module declared
 * `DATASET_USES` (`train`, `export`, `publish`, `share`) with an `evaluateDatasetUse` the
 * export path calls. Two gates, two spellings of the same four ideas, and two spellings of
 * the Article 6 bases (`legal-obligation` against `legal_obligation`) — which meant a
 * dataset governed through one gate was ungoverned at the other.
 *
 * The spellings kept are the ones REAL BOARDS HOLD: `canvas_set_data_use` is the only
 * writer either model ever had, so `training`/`sharing` and the hyphenated bases are the
 * values in stored objects, and adopting the other set would have silently unenforced
 * every policy already declared. `publish` survives from the second list because it is a
 * genuinely different act from `sharing` — a link to a named person versus a public URL.
 */
export const DATASET_USES = ['analysis', 'training', 'evaluation', 'export', 'sharing', 'publish'] as const;
export type DatasetUse = typeof DATASET_USES[number];
/** The name this vocabulary shipped under in `dataScience.ts`. One list, two names, for
 *  the callers that already speak the older one. */
export type DataPurpose = DatasetUse;
export const DATA_PURPOSES = DATASET_USES;

/** GDPR Article 6. Named rather than free text so a gate can reason about them.
 *  Hyphenated, because that is what `canvas_set_data_use` has always written. */
export const LAWFUL_BASES = [
  'consent', 'contract', 'legal-obligation', 'vital-interests', 'public-task', 'legitimate-interests',
] as const;
export type LawfulBasis = typeof LAWFUL_BASES[number];

/**
 * The uses that PUT THE ROWS IN SOMEBODY ELSE'S HANDS, and therefore need a lawful basis
 * recorded.
 *
 * `analysis` and `evaluation` are deliberately not here: asking for consent to look at
 * rows already in front of the person is how a consent prompt becomes furniture, which
 * produces worse governance than none. `export` is not here either, and that one is a
 * judgement rather than an oversight — a download lands on the machine of somebody who
 * already has the rows on screen, so gating it on a basis nobody recorded would refuse the
 * single most common thing anybody does with a dataset, and neither predecessor gate did.
 * An export is still refused by a declared purpose that excludes it, and by an expired
 * retention window.
 */
const PROCESSING_USES: ReadonlySet<DatasetUse> = new Set<DatasetUse>(['training', 'sharing', 'publish']);

/**
 * The IRREVERSIBLE use. Export, publish and share produce a copy somebody can later
 * delete; training produces weights nobody can delete, that cannot honour an erasure
 * request, and that cannot be un-learned. Everything asymmetric below keys off this.
 */
const IRREVERSIBLE_USE: DatasetUse = 'training';

/**
 * The categories training cannot reach on anything weaker than explicit consent.
 *
 * Article 9 in spirit, plus the two that are not Article 9 but cause the same harm when
 * they leak. Legitimate interests cannot carry health records or government identifiers
 * into a model's weights: weights outlive any basis that can later be withdrawn.
 */
const CONSENT_ONLY_FOR_TRAINING: ReadonlySet<PiiCategory> = new Set<PiiCategory>([
  'health', 'government_id', 'financial', 'credentials',
]);

/**
 * The governance envelope a dataset carries, and the gate reads.
 *
 * Stored on the canvas object as `dataUse` — ONE field. The second field this module's
 * predecessor read (`usePolicy`) had no writer anywhere in the product: it was not in
 * `MUTABLE_FIELDS.dataset`, no tool set it, and no importer produced it, so the export
 * gate that consulted it was reading `undefined` on every dataset that has ever existed.
 * That is the defect the merge closes, and it is why the surviving field name is the one
 * with a writer rather than the one with the nicer name.
 */
export interface DatasetUsePolicy {
  /** What the rows may be used FOR. Absent means unrestricted — see the permissive
   *  default argued on {@link evaluateDatasetUse}. */
  purposes?: readonly DatasetUse[];
  /** What the rows were collected for, in the collector's own words. Free text, used to
   *  explain a refusal; `purposes` is the machine-readable half. */
  purpose?: string;
  lawfulBasis?: LawfulBasis;
  /** Days from `collectedAt` the rows may be kept. `0` or absent = no declared limit. */
  retentionDays?: number;
  /** ISO date the rows were collected — the clock `retentionDays` runs from. */
  collectedAt?: string;
}

/** The older name for {@link DatasetUsePolicy}, kept for the canvas call sites that
 *  already speak it. One shape, one gate. */
export type DataUsePolicy = DatasetUsePolicy;

export type UseRefusalCode =
  | 'retention-expired'
  | 'purpose-not-permitted'
  | 'no-lawful-basis'
  | 'special-category-needs-consent';

export interface DatasetUseDecision {
  allowed: boolean;
  code?: UseRefusalCode;
  /** What to say to the person, naming the field that would clear it. Rendered to the
   *  user AND returned to the model, so it is a sentence rather than a code. */
  reason?: string;
  /** The categories that drove the refusal, so a surface can point at the columns. */
  categories?: PiiCategory[];
}

export function isLawfulBasis(value: unknown): value is LawfulBasis {
  return typeof value === 'string' && (LAWFUL_BASES as readonly string[]).includes(value);
}

export function isDatasetUse(value: unknown): value is DatasetUse {
  return typeof value === 'string' && (DATASET_USES as readonly string[]).includes(value);
}

/** Read a policy off a canvas object's `dataUse` — or an `ide_datasets.use_policy`
 *  column — ignoring anything malformed. A tag that cannot be read is DROPPED rather than
 *  coerced: an unreadable basis silently accepted would turn a refusal into a permission. */
export function normalizeUsePolicy(value: unknown): DatasetUsePolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const declared = Array.isArray(raw.purposes) ? raw.purposes.filter(isDatasetUse) : undefined;
  const policy: DatasetUsePolicy = {
    ...(declared && declared.length ? { purposes: declared } : {}),
    ...(typeof raw.purpose === 'string' && raw.purpose.trim() ? { purpose: raw.purpose.trim().slice(0, 400) } : {}),
    ...(isLawfulBasis(raw.lawfulBasis) ? { lawfulBasis: raw.lawfulBasis } : {}),
    ...(typeof raw.retentionDays === 'number' && Number.isFinite(raw.retentionDays) && raw.retentionDays > 0
      ? { retentionDays: Math.floor(raw.retentionDays) } : {}),
    ...(typeof raw.collectedAt === 'string' && raw.collectedAt.trim() ? { collectedAt: raw.collectedAt.trim() } : {}),
  };
  return Object.keys(policy).length ? policy : null;
}

/**
 * May this use of these rows proceed?
 *
 * ── THE PERMISSIVE DEFAULT, AND WHY IT SURVIVES THE MERGE ───────────────────────
 * A dataset with no declared policy and no personal columns is allowed. The overwhelming
 * majority of canvas datasets are a CSV of quarterly revenue that no consent regime
 * touches, and a default-deny would train every user to declare a policy they had not
 * thought about purely to make the button work — which produces worse governance than
 * none, because the declarations would all be lies.
 *
 * ── AND WHY TRAINING IS THE EXCEPTION ───────────────────────────────────────────
 * Once personal data IS present the rules split by how reversible the use is. Export,
 * publish and share produce a copy somebody can later delete; TRAINING produces weights
 * nobody can delete. So training is the one use that must be affirmatively PERMITTED
 * rather than merely not-forbidden, and the one that special categories cannot reach on
 * legitimate interests.
 *
 * Retention is checked first and applies to everything, because expired rows have no
 * lawful use left at all — not even the reversible ones. A declared restriction is
 * checked next and binds whether or not the rows are personal: it is a statement somebody
 * made about these rows, not a technical limit this gate is entitled to second-guess.
 */
export function evaluateDatasetUse(
  use: DatasetUse,
  classifications: readonly ColumnClassification[],
  policy: DatasetUsePolicy | null | undefined,
  now: Date = new Date(),
): DatasetUseDecision {
  const personal = classifications.filter((entry) => entry.pii && entry.pii !== 'none');
  const categories = [...new Set(personal.map((entry) => entry.pii))];

  // 1. Retention. Applies whether or not the rows are personal — a declared window is a
  //    promise made to somebody, and it binds even where the law would not.
  if (policy?.retentionDays && policy.collectedAt) {
    const collected = new Date(policy.collectedAt);
    if (!Number.isNaN(collected.getTime())) {
      const age = Math.floor((now.getTime() - collected.getTime()) / 86_400_000);
      if (age > policy.retentionDays) {
        return {
          allowed: false,
          code: 'retention-expired',
          reason: `These rows passed their declared ${policy.retentionDays}-day retention window ${age - policy.retentionDays} day(s) ago, so they cannot be used for "${use}" — or anything else — until they are re-collected or the window on the dataset is changed.`,
          categories,
        };
      }
    }
  }

  // 2. A declared restriction is decisive, in both directions, personal data or not.
  if (policy?.purposes?.length && !policy.purposes.includes(use)) {
    return {
      allowed: false,
      code: 'purpose-not-permitted',
      reason: `This dataset declares the permitted purposes ${policy.purposes.join(', ')}, and "${use}" is not one of them. Change the declared purposes on the dataset if that is wrong — it is a governance statement somebody made about these rows, not a technical limit.`,
      categories,
    };
  }

  // 3. A lawful basis, for the uses that put the rows in somebody else's hands.
  //
  //    Two triggers, and they are the UNION of what the two predecessor gates asked, which
  //    is deliberate: a merge must not refuse anything either of them permitted, or it
  //    silently breaks working boards in the name of tidiness.
  //      • the rows are PERSONAL and the use is TRAINING — the law asks regardless of
  //        whether anybody filled a form in, and weights cannot be un-trained.
  //      • a POLICY EXISTS and its basis is blank — somebody started governing these rows
  //        and stopped halfway, which is the one case where silence is not ignorance.
  const needsBasis = PROCESSING_USES.has(use)
    && !policy?.lawfulBasis
    && ((use === IRREVERSIBLE_USE && personal.length > 0) || !!policy);
  if (needsBasis) {
    return {
      allowed: false,
      code: 'no-lawful-basis',
      reason: use === IRREVERSIBLE_USE
        ? 'This dataset declares no lawful basis, so it cannot be used as a training corpus. Model weights cannot be un-trained and cannot honour an erasure request, so training has to be decided before it happens rather than justified afterwards.'
        : `This dataset carries a governance policy but no lawful basis, and "${use}" is a use that needs one recorded. Set a lawful basis on the dataset — consent, contract, legitimate interests or another Article 6 basis — before using these rows this way.`,
      categories,
    };
  }

  // 4. Nothing personal left to weigh.
  if (personal.length === 0) return { allowed: true };

  // 5. Training: the irreversible one.
  if (use === IRREVERSIBLE_USE) {
    const special = categories.filter((category) => CONSENT_ONLY_FOR_TRAINING.has(category));
    if (special.length > 0 && policy?.lawfulBasis !== 'consent') {
      return {
        allowed: false,
        code: 'special-category-needs-consent',
        reason: `This dataset holds ${special.join(', ')} data. Training on it needs explicit consent as the lawful basis — "${policy?.lawfulBasis ?? 'none declared'}" is not enough for data of this category, because the weights outlive any basis that can later be withdrawn.`,
        categories: special,
      };
    }
    if (!policy?.purposes?.length) {
      return {
        allowed: false,
        code: 'purpose-not-permitted',
        reason: 'This dataset holds personal data and does not say which purposes it permits. Training has to be permitted explicitly — silence is not permission for the one use that cannot be undone.',
        categories,
      };
    }
  }

  return { allowed: true };
}
