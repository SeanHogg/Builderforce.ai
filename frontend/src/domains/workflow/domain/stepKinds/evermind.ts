import type { NodeKindMeta } from '../stepCatalog';

/**
 * EVERMIND BUILD — the in-browser training pipeline
 *
 * These do not run in the cloud at all: they run on the viewer's own GPU through
 * `lib/evermindBuild.ts`. Kept together because they are one pipeline, in the order it
 * runs — corpus, tokenizer, quality, train, converge, evaluate, benchmark, export.
 *
 * One family per file, assembled by `stepCatalog.ts`. The catalog is ~60 declarations
 * and grows with the product; kept in one file it was the largest module in the tree
 * and every addition edited the same 1,000 lines. A family is a real seam — the palette
 * groups by it, the 3D badge names it, and a new step almost always joins an existing
 * one — so splitting here costs nothing and stops the file from being the place every
 * change collides.
 */
export const EVERMIND_STEP_KINDS: NodeKindMeta[] = [
  {
    kind: 'train',
    label: 'Train',
    icon: '🎓',
    group: 'LLM Logic',
    accent: 'var(--cyan-bright)',
    blurb: 'Train an Evermind model on a dataset (tokenizer → train → package).',
    defaultConfig: { model: '', dataset: '', epochs: 1 },
    fields: [
      { key: 'model', label: 'Model name', type: 'text', placeholder: 'Output model name' },
      { key: 'dataset', label: 'Dataset', type: 'text', placeholder: 'Dataset ref / path' },
      { key: 'epochs', label: 'Epochs', type: 'number' },
    ],
  },
  // --- Evermind Build — engine pipeline steps that run IN-BROWSER (lib/evermindBuild.ts).
  //     Each `kind` equals an engine workflow step `type`, so the graph compiles 1:1
  //     to a WorkflowConfig. Chain them (or load a template) then hit "▶ Build". ---
  {
    kind: 'train-tokenizer',
    label: 'Train Tokenizer',
    icon: '🔤',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Learn a byte-BPE tokenizer from a corpus.',
    defaultConfig: { corpus: '', numMerges: 120 },
    fields: [
      { key: 'corpus', label: 'Corpus', type: 'textarea', placeholder: 'Training text…' },
      { key: 'numMerges', label: 'BPE merges', type: 'number' },
    ],
  },
  {
    kind: 'dataset-quality',
    label: 'Dataset Quality',
    icon: '🧪',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Gate the corpus: min words/sequences + max duplicate ratio.',
    defaultConfig: { minWords: 20, minSequences: 3, maxDuplicateRatio: 0.5 },
    fields: [
      { key: 'minWords', label: 'Min words', type: 'number' },
      { key: 'minSequences', label: 'Min sequences', type: 'number' },
      { key: 'maxDuplicateRatio', label: 'Max duplicate ratio', type: 'number' },
    ],
  },
  {
    kind: 'train-model',
    label: 'Train Model',
    icon: '🧠',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Train an EvermindLM on the corpus (on-device, CPU).',
    defaultConfig: { corpus: '', epochs: 50, dModel: 24, numLayers: 2, hiddenDim: 32 },
    fields: [
      { key: 'corpus', label: 'Corpus', type: 'textarea', placeholder: 'Training text…' },
      { key: 'epochs', label: 'Epochs', type: 'number' },
      { key: 'dModel', label: 'Model dim', type: 'number' },
      { key: 'numLayers', label: 'Layers', type: 'number' },
      { key: 'hiddenDim', label: 'Hidden dim', type: 'number' },
    ],
  },
  {
    kind: 'convergence',
    label: 'Convergence Check',
    icon: '📉',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Assert training loss actually dropped.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'evaluate',
    label: 'Evaluate',
    icon: '📊',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Score held-out perplexity / next-token accuracy.',
    defaultConfig: { prompt: '' },
    fields: [{ key: 'prompt', label: 'Seed prompt', type: 'text', placeholder: 'Optional' }],
  },
  {
    kind: 'generate-check',
    label: 'Generation Check',
    icon: '✍️',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Non-empty + seed-reproducible sampling.',
    defaultConfig: { prompt: '' },
    fields: [{ key: 'prompt', label: 'Seed prompt', type: 'text', placeholder: 'Optional' }],
  },
  {
    kind: 'benchmark',
    label: 'Benchmark',
    icon: '🏁',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Held-out perplexity + accuracy scorecard.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'roundtrip',
    label: 'Package (Round-trip)',
    icon: '📦',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Package → reload → prove identical output. Emits the .evermind artifact.',
    defaultConfig: { name: 'my-llm' },
    fields: [{ key: 'name', label: 'Model name', type: 'text' }],
  },
  {
    kind: 'export',
    label: 'Export',
    icon: '🚀',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Export a publishable repo (Hugging Face / ONNX / safetensors / GGUF).',
    defaultConfig: { format: 'huggingface', name: 'my-llm', version: '1.0.0' },
    fields: [
      { key: 'format', label: 'Format', type: 'select', options: ['huggingface', 'onnx', 'safetensors', 'gguf'] },
      { key: 'name', label: 'Model name', type: 'text' },
      { key: 'version', label: 'Version', type: 'text' },
    ],
  },
  {
    kind: 'distill-corpus',
    label: 'Distil Corpus',
    icon: '🧬',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Build a (prompt → completion) corpus from teacher exemplars (JSON pairs).',
    defaultConfig: { pairs: '[]' },
    fields: [{ key: 'pairs', label: 'Exemplar pairs (JSON)', type: 'textarea', placeholder: '[{"prompt":"…","completion":"…"}]' }],
  },
  {
    kind: 'code-parse-check',
    label: 'Code Parse Check',
    icon: '🔩',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Structural/parse validity of generated code.',
    defaultConfig: { language: 'js' },
    fields: [{ key: 'language', label: 'Language', type: 'select', options: ['js'] }],
  },
  {
    kind: 'code-eval',
    label: 'Code Test Reward',
    icon: '✅',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Execution-grounded test reward (JSON cases).',
    defaultConfig: { cases: '[]' },
    fields: [{ key: 'cases', label: 'Test cases (JSON)', type: 'textarea', placeholder: '[{"call":"add(2,3)","expect":5}]' }],
  },
  {
    kind: 'code-benchmark',
    label: 'Code Benchmark (pass@1)',
    icon: '🎯',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Held-out pass@1 on unseen prompts (JSON tasks).',
    defaultConfig: { tasks: '[]' },
    fields: [{ key: 'tasks', label: 'Tasks (JSON)', type: 'textarea', placeholder: '[{"prompt":"function add","cases":[…]}]' }],
  },
];
