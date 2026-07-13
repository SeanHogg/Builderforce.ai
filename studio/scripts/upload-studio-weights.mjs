#!/usr/bin/env node
/**
 * upload-studio-weights — push the canonical Studio ONNX model files into R2 so
 * the browser engine's preferred `r2-proxy` weight source actually resolves.
 *
 * Why this exists
 * ---------------
 * The studio engine fetches each weight from, in order:
 *   1. `https://api.builderforce.ai/api/studio/weights/<model>/<file>`  (R2 proxy)
 *   2. the HuggingFace CDN                                              (fallback)
 * The R2 proxy route (api/src/presentation/routes/studioWeightRoutes.ts) streams
 * R2 key `studio-weights/<model>/<file>` from the `UPLOADS` bucket
 * (`builderforce-uploads`). Until the objects exist there, EVERY cold weight
 * load 404s the proxy and falls through to HF — adding 300–800 ms latency per
 * file and exposing us to HF rate limits. This script populates R2 so the proxy
 * serves first-party, immutable, edge-cached weights.
 *
 * What it uploads
 * ---------------
 * The MANIFEST below mirrors `MODEL_REGISTRY` in
 * `studio/src/engine/diffusion-engine.ts` — same model ids, same `hfRepo`, same
 * per-model file list (text encoder, UNet [+ external-data sidecar], VAE
 * decoder [+ sidecar]). KEEP IT IN SYNC: if you add a model or change a file
 * path in the registry, update this manifest too (a wrong path here uploads to a
 * key the engine never requests, silently leaving it on the HF fallback).
 *
 * Usage
 * -----
 *   node scripts/upload-studio-weights.mjs [options]
 *
 *   --model <id>     Only this model id (repeatable). Default: all in MANIFEST.
 *   --from <dir>     Use already-downloaded files from <dir>/<model>/<file>
 *                    instead of fetching from the HF CDN.
 *   --bucket <name>  R2 bucket name. Default: builderforce-uploads.
 *   --remote         Operate on the deployed (remote) R2 bucket, not the local
 *                    miniflare one. Pass this for production uploads.
 *   --dry-run        Print the wrangler commands without downloading/uploading.
 *   --help           Show this help.
 *
 * Prerequisites: `wrangler` on PATH and authenticated (`wrangler login`), run
 * from the api worker's directory context (so the bucket binding resolves), or
 * pass `--remote` for the deployed bucket. Node 18+ (global fetch).
 *
 * Examples
 * --------
 *   # Download from HF and push everything to the remote prod bucket:
 *   node scripts/upload-studio-weights.mjs --remote
 *
 *   # Re-upload just one fine-tuned model from a local export dir:
 *   node scripts/upload-studio-weights.mjs --model lcm-dreamshaper-v7 \
 *     --from ./weights --remote
 *
 *   # See exactly what would run, change nothing:
 *   node scripts/upload-studio-weights.mjs --dry-run
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Canonical model → R2 file manifest. Mirrors MODEL_REGISTRY[*].files +
 * MODEL_REGISTRY[*].hfRepo in studio/src/engine/diffusion-engine.ts.
 */
const MANIFEST = [
  {
    model: 'lcm-tiny-sd',
    hfRepo: 'akameswa/lcm-tiny-sd-onnx-fp16',
    files: [
      'text_encoder/model.onnx',
      'unet/model.onnx',
      'unet/model.onnx_data',
      'vae_decoder/model.onnx',
      'vae_decoder/model.onnx_data',
    ],
  },
  {
    model: 'lcm-dreamshaper-v7',
    hfRepo: 'aislamov/lcm-dreamshaper-v7-onnx',
    files: [
      'text_encoder/model.onnx',
      'unet/model.onnx',
      'unet/model.onnx_data',
      'vae_decoder/model.onnx',
      'vae_decoder/model.onnx_data',
    ],
  },
  {
    model: 'sd-turbo',
    hfRepo: 'schmuell/sd-turbo-ort-web',
    files: ['text_encoder/model.onnx', 'unet/model.onnx', 'vae_decoder/model.onnx'],
  },
];

const R2_PREFIX = 'studio-weights';
const DEFAULT_BUCKET = 'builderforce-uploads';

function parseArgs(argv) {
  const opts = { models: [], from: null, bucket: DEFAULT_BUCKET, remote: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--model') opts.models.push(argv[++i]);
    else if (a === '--from') opts.from = argv[++i];
    else if (a === '--bucket') opts.bucket = argv[++i];
    else if (a === '--remote') opts.remote = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else {
      console.error(`Unknown argument: ${a}`);
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  // The block comment at the top is the canonical docs; echo a short form.
  console.log(
    [
      'upload-studio-weights — push Studio ONNX weights into R2 (studio-weights/<model>/<file>).',
      '',
      'Usage: node scripts/upload-studio-weights.mjs [--model <id>]... [--from <dir>]',
      '         [--bucket <name>] [--remote] [--dry-run]',
      '',
      'See the file header for full documentation.',
    ].join('\n'),
  );
}

/** Resolve a local file path for <model>/<file>: from --from dir if present,
 *  else download from the HF CDN into a temp dir. Returns the local path. */
async function ensureLocalFile(entry, file, fromDir, tmpRoot, dryRun) {
  if (fromDir) {
    const local = join(fromDir, entry.model, file);
    if (!existsSync(local)) {
      throw new Error(`--from set but missing: ${local}`);
    }
    return local;
  }
  const dest = join(tmpRoot, entry.model, file);
  const url = `https://huggingface.co/${entry.hfRepo}/resolve/main/${file}`;
  if (dryRun) {
    console.log(`   [dry-run] would download ${url}`);
    return dest;
  }
  mkdirSync(dirname(dest), { recursive: true });
  process.stdout.write(`   ↓ ${url} … `);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed (${res.status} ${res.statusText}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB`);
  return dest;
}

/** Upload one local file to R2 via wrangler. ONNX blobs are opaque binary. */
function uploadToR2(localPath, r2Key, bucket, remote, dryRun) {
  const args = [
    'r2',
    'object',
    'put',
    `${bucket}/${r2Key}`,
    `--file=${localPath}`,
    '--content-type=application/octet-stream',
  ];
  if (remote) args.push('--remote');
  if (dryRun) {
    console.log(`   [dry-run] wrangler ${args.join(' ')}`);
    return;
  }
  process.stdout.write(`   ↑ ${r2Key} … `);
  execFileSync('wrangler', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('ok');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const entries = opts.models.length
    ? MANIFEST.filter((m) => opts.models.includes(m.model))
    : MANIFEST;
  if (entries.length === 0) {
    console.error(
      `No matching models. Known: ${MANIFEST.map((m) => m.model).join(', ')}`,
    );
    process.exit(1);
  }

  console.log(
    `Uploading ${entries.length} model(s) to R2 bucket "${opts.bucket}" ` +
      `(${opts.remote ? 'remote' : 'local'}${opts.dryRun ? ', dry-run' : ''})…`,
  );

  const tmpRoot = opts.from || opts.dryRun ? '' : mkdtempSync(join(tmpdir(), 'studio-weights-'));
  let uploaded = 0;
  try {
    for (const entry of entries) {
      console.log(`\n• ${entry.model}  (${entry.hfRepo})`);
      for (const file of entry.files) {
        const local = await ensureLocalFile(entry, file, opts.from, tmpRoot, opts.dryRun);
        uploadToR2(local, `${R2_PREFIX}/${entry.model}/${file}`, opts.bucket, opts.remote, opts.dryRun);
        uploaded++;
      }
    }
  } finally {
    if (tmpRoot && existsSync(tmpRoot)) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }

  console.log(
    `\n${opts.dryRun ? '[dry-run] ' : ''}Done — ${uploaded} file(s) ` +
      `${opts.dryRun ? 'planned' : 'uploaded'} to ${opts.bucket}/${R2_PREFIX}/.`,
  );
}

main().catch((err) => {
  console.error(`\nupload-studio-weights failed: ${err.message}`);
  process.exit(1);
});
