/**
 * The DATA-SCIENCE vocabulary — the half of "idea to REAL" that comes after the data.
 *
 * ── WHY THIS SET EXISTS ──────────────────────────────────────────────────────────
 * The canvas had a genuinely strong DATA stage: `dataset` and `datasource` draw the
 * snapshot/live split, `dataContract` declares what rows are allowed to be,
 * `dataQuality` checks them, `metric` defines a number and `lineage` says where a
 * value came from. Then the arc stopped. Measured against the seven stages a data
 * scientist actually works through — idea → data → analysis → model → evaluation →
 * ship → monitor — the board was strong at the first two, thin at the third, and had
 * NO OBJECT AT ALL for the last four.
 *
 * The specifics, each of which is one kind below:
 *
 *  • There was nowhere to COMPUTE. The `code` kind stores `code`, `language` and
 *    `path` — text, with no execution and no output — so every analysis had to be
 *    expressible in the declarative query language or it could not happen. The
 *    onboarding template seeded a card titled "Tokenizer & training notebook" that
 *    could not execute a cell.
 *  • There was no MODEL. A hundred and fifteen kinds, and the closest was `llm`:
 *    `{model, instructions, parameters}` with a default status of `'Blueprint'`, which
 *    is a prompt-configuration card. The central artifact of the role — the thing that
 *    took a week to train and that production will depend on — had nowhere to sit.
 *  • The fine-tune runner was ALREADY BUILT and unreachable. `ide_training_jobs`
 *    stores base model, LoRA rank, epochs, batch size, learning rate, per-step loss and
 *    a four-axis eval scorecard; `/api/ide/training/*` serves it. A canvas `build`
 *    object of modality `finetune` LAUNCHES that run — and then loses it, because no
 *    tool read it back and no kind could hold it.
 *  • Nothing compared two runs, so model selection happened in a spreadsheet.
 *  • Eval sets had no legitimate origin: no labelling surface, so the only path to
 *    test cases was a model writing its own and grading itself.
 *  • Prompts were versioned SERVER-SIDE (`prompt_library_entries`,
 *    `prompt_library_versions`) and unversioned on the board, so the daily work of LLM
 *    engineering — change it, measure the delta, keep the winner — happened elsewhere.
 *
 * ── THE AUTHORED / DERIVED SPLIT, APPLIED TO EVIDENCE ────────────────────────────
 * This vocabulary leans on `SpecField.derived` harder than any other, and for the same
 * reason the academic set does: most of what these objects hold is EVIDENCE, and a
 * model that could write evidence could report a result nobody measured. A loss curve
 * is read from a training job. A label is what a human actually chose. An eval score
 * is what a run produced. All of them are readable and none of them are authorable —
 * which is the difference between a board that records an experiment and a board that
 * can be talked into agreeing with you.
 *
 * ── WHAT IS DELIBERATELY NOT A KIND ─────────────────────────────────────────────
 * A `featureSet` is not here: a feature definition IS a `metric` in the semantic layer
 * (formula, grain, dimensions) and giving features a second home is how a definition
 * and a feature come to disagree about the same column. A `deployment` is not here
 * either — `model.lifecycle` is a column value, and "a new kind is a column value, not
 * a new table" governs canvas kinds for the same reason it governs schema.
 */

export const DATA_SCIENCE_OBJECT_KINDS = [
  // ── ANALYSIS ────────────────────────────────────────────────────────────────
  // The cell. Its outputs are first-class canvas artifacts rather than a scrollback
  // buffer, which is what makes an analysis something the next turn can reason over
  // instead of something a person has to re-read.
  'notebook',
  // ── MODEL ───────────────────────────────────────────────────────────────────
  // What was trained, and one run that trained it. Two kinds rather than one, and it
  // is the same split `metric`/`liveMetric` and `inbox`/`email` already draw: a
  // `model` is the ARTIFACT that persists and gets promoted, a `trainingRun` is one
  // EXECUTION that produced a loss curve and a scorecard and then stopped changing.
  // Collapsing them would mean a model could only ever remember its most recent run.
  'model', 'trainingRun',
  // N runs side by side with their hyperparameters and their metrics. Its own kind
  // rather than a view because the CHOICE is an artifact: "we picked this config, at
  // this cost, over that one" is exactly the reasoning a `decision` object cites.
  'runComparison',
  // ── EVALUATION ──────────────────────────────────────────────────────────────
  // Where an eval set legitimately comes from: sampled rows, a question, the humans
  // who answered it, and their agreement. `labels` is derived for the same reason
  // `practice.attempts` and an academic `marks` field are — it is the record of what a
  // person actually chose, and a model that could write it could manufacture consensus.
  'labelSet',
  // ── SHIP ────────────────────────────────────────────────────────────────────
  // The prompt as a VERSIONED artifact with an evaluation attached, backed by the
  // prompt library the platform already stores. `llm.instructions` was a bare string
  // with no history and nothing to diff against.
  'prompt',
] as const;

export type DataScienceObjectKind = typeof DATA_SCIENCE_OBJECT_KINDS[number];

const DATA_SCIENCE_KIND_SET: ReadonlySet<string> = new Set<string>(DATA_SCIENCE_OBJECT_KINDS);

/** True for the data-science kinds — the set `dataScienceObjects.ts` specs. */
export function isDataScienceObjectKind(value: unknown): value is DataScienceObjectKind {
  return typeof value === 'string' && DATA_SCIENCE_KIND_SET.has(value);
}

// ---------------------------------------------------------------------------
// The notebook kernel contract
// ---------------------------------------------------------------------------

/**
 * Languages a `notebook` cell may declare.
 *
 * `js` is the only one that executes IN THE BROWSER, and it is not a compromise so
 * much as the only honest option at this layer: a Python kernel means shipping a
 * ~10MB WebAssembly runtime to every visitor of a public landing canvas, which is a
 * bundle-and-hosting decision rather than an engineering one. `python` and `sql` are
 * declared here because a cell must be able to SAY what it is — a notebook that can
 * only describe itself as JavaScript would silently mislabel work destined for the
 * Builder container, and the kernel refuses a language it cannot run rather than
 * pretending to have run it.
 */
export const NOTEBOOK_LANGUAGES = ['js', 'python', 'sql'] as const;
export type NotebookLanguage = typeof NOTEBOOK_LANGUAGES[number];

/** The shapes a cell may return. Anything else is rendered as its JSON. */
export const NOTEBOOK_OUTPUT_KINDS = ['value', 'table', 'chart', 'error'] as const;
export type NotebookOutputKind = typeof NOTEBOOK_OUTPUT_KINDS[number];

/**
 * How long one cell may run before the kernel is torn down.
 *
 * A notebook cell is arbitrary code the model may have written, so an infinite loop is
 * not an edge case but an expected input. The worker is TERMINATED rather than asked
 * to stop, because a runaway loop cannot service a cooperative cancellation.
 */
export const NOTEBOOK_CELL_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Model lifecycle
// ---------------------------------------------------------------------------

/**
 * Where a model is in its life. A COLUMN VALUE, not six kinds.
 *
 * `shadow` earns its place between `evaluated` and `production` because it is the only
 * state in which a model is receiving real traffic and is not yet responsible for the
 * answer — the state every safe rollout passes through, and the one a two-state
 * draft/live flag cannot express.
 */
export const MODEL_LIFECYCLE_STATES = ['draft', 'training', 'evaluated', 'shadow', 'production', 'retired'] as const;
export type ModelLifecycleState = typeof MODEL_LIFECYCLE_STATES[number];

/** What the model is FOR. Decides which metrics are meaningful on its scorecard. */
export const MODEL_TASKS = ['classification', 'regression', 'generation', 'embedding', 'ranking', 'clustering', 'forecasting'] as const;
export type ModelTask = typeof MODEL_TASKS[number];

// ---------------------------------------------------------------------------
// The data-use gate
// ---------------------------------------------------------------------------

/**
 * The lawful basis a dataset is held under, in GDPR Article 6 terms.
 *
 * ── WHY THIS IS ON THE CONTRACT AND NOT IN A COMPLIANCE PAGE ────────────────────
 * `canvas_classify_dataset` already scanned for PII and `dataContract` already carried
 * governance tags — and both stopped at DESCRIPTION. Nothing bound a classification to
 * a USE, so nothing prevented a dataset classified as personal data from becoming the
 * corpus of a fine-tune or the body of an export. The product already models the right
 * idea one kind over: `battlecard.doNotSay` is a restriction that travels WITH the
 * object. This is the same move for personal data, and it has to live in the contract
 * because the gate that reads it runs on both the client and the API.
 */
export const LAWFUL_BASES = ['consent', 'contract', 'legal-obligation', 'vital-interests', 'public-task', 'legitimate-interests'] as const;
export type LawfulBasis = typeof LAWFUL_BASES[number];

/** What a dataset may be USED for. A corpus whose purposes exclude the use is refused. */
export const DATA_PURPOSES = ['analysis', 'training', 'evaluation', 'export', 'sharing'] as const;
export type DataPurpose = typeof DATA_PURPOSES[number];

/** The governance envelope a dataset carries, and the gate reads. */
export interface DataUsePolicy {
  purposes?: readonly DataPurpose[];
  lawfulBasis?: LawfulBasis;
  /** Days the rows may be retained. `0` or absent means no declared limit. */
  retentionDays?: number;
  /** ISO instant the rows were collected — the clock retention is measured from. */
  collectedAt?: string;
}

/** A refusal, or `null` when the use is permitted. Rendered to the user AND returned
 *  to the model, so the reason has to be a sentence rather than a code. */
export interface DataUseRefusal {
  reason: 'purpose-not-permitted' | 'retention-expired' | 'no-lawful-basis';
  /** The purpose that was attempted. */
  purpose: DataPurpose;
  message: string;
}

/**
 * May these rows be used this way?
 *
 * ── THE DEFAULT IS PERMISSIVE, AND THAT IS DELIBERATE ───────────────────────────
 * A dataset with NO declared policy is allowed, because the overwhelming majority of
 * canvas datasets are a CSV of quarterly revenue that no consent regime touches, and a
 * default-deny would train every user to declare a policy they had not thought about
 * purely to make the button work — which produces worse governance than none, because
 * the declarations would all be lies.
 *
 * The gate bites exactly when someone HAS said something: a dataset whose purposes are
 * declared and exclude `training` cannot be a fine-tune corpus, and one whose retention
 * has run out cannot be used for anything. A classification without a policy is a
 * description, which is what it always was; a policy is a restriction, which is new.
 */
export function checkDataUse(policy: DataUsePolicy | null | undefined, purpose: DataPurpose, nowMs: number): DataUseRefusal | null {
  if (!policy) return null;
  if (policy.purposes?.length && !policy.purposes.includes(purpose)) {
    return {
      reason: 'purpose-not-permitted',
      purpose,
      message: `This dataset declares the permitted purposes ${policy.purposes.join(', ')}, and "${purpose}" is not one of them. Change the declared purposes on the dataset if that is wrong — it is a governance statement someone made about these rows, not a technical limit.`,
    };
  }
  if (policy.retentionDays && policy.retentionDays > 0 && policy.collectedAt) {
    const collected = Date.parse(policy.collectedAt);
    if (Number.isFinite(collected) && nowMs - collected > policy.retentionDays * 86_400_000) {
      return {
        reason: 'retention-expired',
        purpose,
        message: `These rows declare a ${policy.retentionDays}-day retention window that expired on ${new Date(collected + policy.retentionDays * 86_400_000).toISOString().slice(0, 10)}. They cannot be used for "${purpose}" until they are re-collected or the window is changed.`,
      };
    }
  }
  // A lawful basis is required only for the uses that PROCESS the rows into something
  // that leaves the board. Analysis of data already sitting in front of the user is
  // not the moment to ask, and asking there is how a consent prompt becomes furniture.
  if (!policy.lawfulBasis && (purpose === 'training' || purpose === 'sharing')) {
    return {
      reason: 'no-lawful-basis',
      purpose,
      message: `This dataset carries a governance policy but no lawful basis, and "${purpose}" is a use that needs one recorded. Set a lawful basis on the dataset — consent, contract, legitimate interests or another Article 6 basis — before using these rows this way.`,
    };
  }
  return null;
}
