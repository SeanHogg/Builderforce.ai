#!/usr/bin/env node
/**
 * The WebLLM half of the page engines' model catalog —
 * `packages/local-inference/src/webllmCatalog.generated.ts`.
 *
 * `@mlc-ai/web-llm` ships ~160 prebuilt builds in `prebuiltAppConfig.model_list`. Writing
 * them out by hand is how the catalog stuck at four rows; reading them at runtime would
 * drag the whole engine into every picker. So this script reads the INSTALLED library
 * (brain-embedded pins its version) and writes the rows as pure data: no web-llm import
 * in the output, one row per build a person could sensibly pick.
 *
 *   node scripts/gen-webllm-catalog.mjs          regenerate the file
 *   node scripts/gen-webllm-catalog.mjs --check  the file matches the installed library (CI)
 *
 * `--check` is a registered guard (frontend/scripts/checks.manifest.mjs — the frontend
 * install is the one that installs brain-embedded's dependencies, so web-llm is on disk
 * there). It fails on drift: a library bump, or a hand edit of the generated file.
 *
 * What is kept: the `q4f16_1` build of each model (a `q0f16` one only when no q4f16
 * exists); the `-1k` low-resource variants; every embedding build (they are `q0f32`).
 * Dropped: f32 duplicates, and anything needing more than 24 GB of VRAM.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brainEmbedded = join(repoRoot, 'brain-embedded');
const outFile = join(repoRoot, 'packages', 'local-inference', 'src', 'webllmCatalog.generated.ts');
const outRelative = 'packages/local-inference/src/webllmCatalog.generated.ts';

const MB = 1024 * 1024;
const MAX_VRAM_MB = 24_000;
/** WebLLM's `ModelType` enum. */
const MODEL_TYPE = { llm: 0, embedding: 1, vlm: 2 };

/**
 * The curated short list a picker shows before "All models", by what it is for. Every id
 * must exist in the generated rows — a library bump that drops one fails here rather
 * than leaving a recommendation that quietly vanished.
 */
const RECOMMENDED = {
  chat: [
    'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    'Qwen3-4B-q4f16_1-MLC',
    'Phi-3.5-mini-instruct-q4f16_1-MLC',
    'gemma-2-2b-it-q4f16_1-MLC',
    'Llama-3.1-8B-Instruct-q4f16_1-MLC',
  ],
  coding: [
    'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
  ],
  // 0.2.84 ships no DeepSeek-R1-Distill-Qwen-1.5B; Ministral's 3B reasoning build is the
  // small option instead.
  reasoning: ['Ministral-3-3B-Reasoning-2512-q4f16_1-MLC', 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC'],
  math: ['Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC'],
  tools: ['Hermes-3-Llama-3.1-8B-q4f16_1-MLC', 'Hermes-2-Pro-Mistral-7B-q4f16_1-MLC'],
  embedding: ['snowflake-arctic-embed-s-q0f32-MLC-b4', 'snowflake-arctic-embed-m-q0f32-MLC-b4'],
};

/** Parameter counts the id does not spell, or spells too roughly (publishers' cards). */
const PARAMS = {
  'Llama-3.2-3B-Instruct': 3_210_000_000,
  'Hermes-3-Llama-3.1-8B': 8_030_000_000,
  'Phi-3.5-mini-instruct': 3_820_000_000,
  'Phi-3-mini-4k-instruct': 3_820_000_000,
  'Phi-3.5-vision-instruct': 4_150_000_000,
  'Phi-4-mini-instruct': 3_840_000_000,
  'phi-2': 2_780_000_000,
  'phi-1_5': 1_420_000_000,
  'snowflake-arctic-embed-m': 109_000_000,
  'snowflake-arctic-embed-s': 33_000_000,
};

/** Download sizes MEASURED as the summed files of the MLC repo on Hugging Face. */
const MEASURED_BYTES = {
  'Qwen3-1.7B-q4f16_1-MLC': 984_156_278,
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': 1_816_811_105,
  'Qwen3-4B-q4f16_1-MLC': 2_279_167_154,
  'Hermes-3-Llama-3.1-8B-q4f16_1-MLC': 4_526_847_881,
};

/** Bits per weight by quantization, for the size estimate. q4f16_1 group-quantizes, so
 *  its scales add half a bit — within 3% of the four measured repos above. */
const QUANT_BITS = { q4f16_1: 4.5, q4f32_1: 4.5, q3f16_1: 3.5, q0f16: 16, q0f32: 32 };

/** Families the id-before-the-size rule names badly. */
const FAMILY = { 'snowflake-arctic-embed-m': 'snowflake-arctic-embed', 'snowflake-arctic-embed-s': 'snowflake-arctic-embed' };

/** Words the label title-cases wrongly. */
const LABEL_WORDS = { it: 'IT', hf: 'HF', jpn: 'JPN', stablelm: 'StableLM', s: 'S', m: 'M' };

function fail(message) {
  console.error(`❌  webllm catalog: ${message}`);
  process.exit(1);
}

async function loadWebLlm() {
  const manifest = join(brainEmbedded, 'package.json');
  let entry;
  try {
    entry = createRequire(manifest).resolve('@mlc-ai/web-llm');
  } catch {
    fail('@mlc-ai/web-llm is not installed under brain-embedded — run `pnpm install` there (the frontend install does it via ensure-linked-deps).');
  }
  const pkgFile = join(dirname(dirname(entry)), 'package.json');
  const version = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, 'utf8')).version : 'unknown';
  const lib = await import(pathToFileURL(entry).href);
  if (!lib.prebuiltAppConfig?.model_list) fail(`${entry} exports no prebuiltAppConfig.model_list.`);
  return { version, modelList: lib.prebuiltAppConfig.model_list, functionCalling: new Set(lib.functionCallingModelIds ?? []) };
}

/** `Qwen3-4B-q4f16_1-MLC-1k` → { base: 'Qwen3-4B', quant: 'q4f16_1', variant: '1k' }. */
function parseId(modelId) {
  const m = /^(.*?)-(q\d+f\d+(?:_\d+)?)-MLC(?:-(.+))?$/.exec(modelId);
  return m ? { base: m[1], quant: m[2], variant: m[3] ?? '' } : null;
}

const SIZE_TOKEN = /(?:^|-)(\d+(?:[._]\d+)?)([bm])(?=-|$)/i;

function paramsOf(base) {
  if (PARAMS[base]) return PARAMS[base];
  const m = SIZE_TOKEN.exec(base);
  if (!m) fail(`no parameter count for ${base} — add it to PARAMS in this script.`);
  return Math.round(Number(m[1].replace('_', '.')) * (m[2].toLowerCase() === 'b' ? 1e9 : 1e6));
}

function familyOf(base) {
  if (FAMILY[base]) return FAMILY[base];
  const m = SIZE_TOKEN.exec(base);
  const head = m ? base.slice(0, m.index) : base.replace(/-(instruct|chat|it)$/i, '');
  return head.toLowerCase();
}

function labelOf(base, variant) {
  const words = base.split('-').map((word, i) => {
    const lower = word.toLowerCase();
    if (LABEL_WORDS[lower]) return LABEL_WORDS[lower];
    if (/^\d+(?:[._]\d+)?[bm]$/i.test(word)) return word.replace('_', '.').toUpperCase();
    if (/^\d+_\d+$/.test(word)) return word.replace('_', '.');
    if (/^[a-z]+$/.test(word) && word.length > 2) return word[0].toUpperCase() + word.slice(1);
    // The model's name leads: `gemma3` → `Gemma3`, `phi` → `Phi`.
    if (i === 0 && /^[a-z]/.test(word)) return word[0].toUpperCase() + word.slice(1);
    return word;
  });
  return variant ? `${words.join(' ')} · ${variant.toUpperCase()}` : words.join(' ');
}

function usesOf(base, modelType) {
  if (modelType === MODEL_TYPE.embedding) return ['embedding'];
  const uses = [];
  if (/coder/i.test(base)) uses.push('coding');
  if (/(?:^|-)r1(?:-|$)|reasoning/i.test(base)) uses.push('reasoning');
  if (/math/i.test(base)) uses.push('math');
  if (modelType === MODEL_TYPE.vlm || /vision/i.test(base)) uses.push('vision');
  return uses.length ? uses : ['chat'];
}

/** The builds kept: see the module header. Also returns the base models dropped because
 *  they ship no q4f16_1 / q0f16 build (only q4f32 / q3f16), so a run says what it left out. */
function selectBuilds(modelList) {
  const byKey = new Map();
  for (const record of modelList) {
    const id = parseId(record.model_id);
    if (!id) fail(`cannot parse model id ${record.model_id}.`);
    if (record.vram_required_MB > MAX_VRAM_MB) continue;
    const key = `${id.base}|${id.variant}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ record, id });
  }
  const kept = [];
  const skipped = [];
  for (const [key, builds] of byKey) {
    if (builds[0].record.model_type === MODEL_TYPE.embedding) {
      kept.push(...builds);
      continue;
    }
    const pick = builds.find((b) => b.id.quant === 'q4f16_1') ?? builds.find((b) => b.id.quant === 'q0f16');
    if (pick) kept.push(pick);
    else skipped.push({ base: key.replace(/\|$/, '').replace('|', ' · '), builds: builds.map((b) => b.record.model_id) });
  }
  return { kept, skipped };
}

function entryOf({ record, id }, functionCalling, recommended) {
  const params = paramsOf(id.base);
  const bits = QUANT_BITS[id.quant];
  if (!bits) fail(`no bits-per-weight for ${id.quant} (${record.model_id}) — add it to QUANT_BITS.`);
  const embedding = record.model_type === MODEL_TYPE.embedding;
  const entry = {
    modelId: record.model_id,
    label: labelOf(id.base, id.variant),
    family: familyOf(id.base),
    params,
    bytes: MEASURED_BYTES[record.model_id] ?? Math.round((params * bits) / 8),
    contextTokens: record.overrides?.context_window_size ?? 4096,
    tools: functionCalling.has(record.model_id),
    // Embedding builds carry no flag; every one is a sub-2 GB encoder.
    lowResource: record.low_resource_required ?? embedding,
    vramBytes: Math.round(record.vram_required_MB * MB),
    f16: id.quant.includes('f16') || (record.required_features ?? []).includes('shader-f16'),
    ...(record.buffer_size_required_bytes ? { bufferBytes: record.buffer_size_required_bytes } : {}),
    uses: usesOf(id.base, record.model_type),
    recommended: recommended.has(record.model_id),
  };
  return entry;
}

function render(version, entries) {
  const literal = (value) =>
    Array.isArray(value) ? `[${value.map(literal).join(', ')}]` : typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value);
  const lines = entries.map((e) => `  { ${Object.entries(e).map(([k, v]) => `${k}: ${literal(v)}`).join(', ')} },`);
  return [
    '/**',
    ` * GENERATED from @mlc-ai/web-llm@${version} \`prebuiltAppConfig\` — do not edit by hand.`,
    ' * Regenerate with `node scripts/gen-webllm-catalog.mjs`; `--check` (a registered guard)',
    ' * fails when this file and the installed library disagree. The selection rules and the',
    ' * curated `recommended` list live in that script.',
    ' */',
    "import type { WebLlmCatalogEntry } from './catalogEntry.js';",
    '',
    `/** ${entries.length} WebLLM builds, smallest VRAM first. */`,
    'export const WEBLLM_CATALOG: readonly WebLlmCatalogEntry[] = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}

const { version, modelList, functionCalling } = await loadWebLlm();
const recommended = new Set(Object.values(RECOMMENDED).flat());
const { kept, skipped } = selectBuilds(modelList);
// Not an error (the guard stays green): a base with only q4f32 / q3f16 builds is left out
// on purpose, but never silently.
for (const { base, builds } of skipped) {
  console.warn(`⚠️  webllm catalog: skipped ${base} — no q4f16_1 / q0f16 build (only ${builds.join(', ')}).`);
}
if (skipped.length) console.warn(`⚠️  webllm catalog: ${skipped.length} base model(s) skipped: ${skipped.map((s) => s.base).join(', ')}.`);
const entries = kept
  .map((build) => entryOf(build, functionCalling, recommended))
  .sort((a, b) => a.vramBytes - b.vramBytes || a.modelId.localeCompare(b.modelId));
const missing = [...recommended].filter((id) => !entries.some((e) => e.modelId === id));
if (missing.length) fail(`recommended ids not in the generated rows: ${missing.join(', ')}.`);
const content = render(version, entries);

if (process.argv.includes('--check')) {
  const current = existsSync(outFile) ? readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== content) fail(`${outRelative} is stale for web-llm@${version} — run \`node scripts/gen-webllm-catalog.mjs\`.`);
  console.log(`✅  webllm catalog: ${entries.length} row(s) match web-llm@${version}.`);
  process.exit(0);
}

writeFileSync(outFile, content);
console.log(`[webllm-catalog] wrote ${entries.length} row(s) from web-llm@${version} to ${outRelative}.`);
