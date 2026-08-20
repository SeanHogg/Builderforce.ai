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
// The data-use gate — MOVED
// ---------------------------------------------------------------------------
//
// `LAWFUL_BASES`, `DATA_PURPOSES`, `DataUsePolicy` and `checkDataUse` were declared here
// and, independently, in the canvas governance module — two gates over one question, with
// two spellings of the Article 6 bases and two vocabularies for the same five purposes. A
// dataset governed through one was ungoverned at the other, and the second gate read a
// field (`usePolicy`) that no writer in the product has ever produced.
//
// They are now one, in `./dataGovernance`, which this package re-exports. The names this
// module used are kept there as aliases (`DATA_PURPOSES`, `DataPurpose`, `DataUsePolicy`)
// so no call site had to be renamed to be corrected. `checkDataUse` is gone rather than
// aliased: its signature could not see the column classifications, which is exactly the
// input that decides whether training may proceed — a gate that cannot see the PII is the
// gate that let a fine-tune through. Callers ask `evaluateDatasetUse` instead.
