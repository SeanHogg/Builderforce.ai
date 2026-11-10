/**
 * delta/adapters/l3Cache.ts — THE L3 result cache (PRD 41 §B7, B8.3), shared by the two places that run the whole-tree
 * analyzers: the background indexer's L3 pass (`analyseWorkspace`, through `createAnalyzeCodebaseTool`) and the run
 * delta's analyzer tier (the host's `repoAnalyzers`). One key, one entry shape, one store (the host's port):
 *
 *   key    {@link l3CacheKey} — tool + its pinned version, the configuration hash (ignored folders, the layer registry,
 *          the offline database's date), the hash of the tool's declared input files, and the tree's content hash;
 *   entry  {@link L3CacheEntry} — the normalized run-delta `AnalyzerResult` (what the delta reads), and the tool's raw
 *          report (what the indexer's analysis snapshot is built from), when the writer had it.
 *
 * So the run delta reuses the indexer's results for the base commit's tree, and the indexer reuses a delta's: whichever
 * ran first. Pure (the store and the key's parts are the host's).
 */

import { sha256Hex } from '@seanhogg/builderforce-memory/retrieval';
import type { AnalyzerRunResult } from './analyzer.js';

/** Bumps when the entry shape or an adapter's normalization changes (every old entry then misses). */
export const L3_CACHE_VERSION = 3;

export interface L3CacheKeyParts {
  tool: string;
  /** The pinned version of a bundled tool, or the resolved program's identity for a PATH tool. */
  version: string;
  /** Hash of the configuration the host built for the tool. */
  config: string;
  /** Hash of the tool's declared input files on this side. */
  inputs: string;
  /** The tree's content hash. */
  tree: string;
}

export const l3CacheKey = (k: L3CacheKeyParts): string =>
  sha256Hex(JSON.stringify([L3_CACHE_VERSION, k.tool, k.version, k.config, k.inputs, k.tree]));

export interface L3CacheEntry {
  result: AnalyzerRunResult;
  /** The tool's raw report (jscpd / knip / dependency-cruiser JSON), when the writer had it. */
  raw?: unknown;
}

/** The host's store. Never throws (a miss or an unwritable store is just no cache); only `ok` results are kept. */
export interface L3ResultCache {
  get(key: string, tool: string): Promise<L3CacheEntry | undefined>;
  put(key: string, entry: L3CacheEntry): Promise<void>;
}

/** What an analysis run is handed to read and write the shared cache: the store, the key of each tool on THIS tree, and the run's file universe. */
export interface L3CacheBinding {
  cache: L3ResultCache;
  /** The key of a tool's result on the tree being analyzed; undefined ⇒ the tree is not content-addressed (no cache). */
  keyOf(tool: string): Promise<string | undefined>;
  /** Folders git ignores in the tree: excluded exactly as the run delta's adapters exclude them, so the results are one. */
  ignored(): Promise<readonly string[]>;
}

/** A result read for another side: every evidence row on that side. */
export function onSide(result: AnalyzerRunResult, side: 'before' | 'after'): AnalyzerRunResult {
  return { ...result, findings: result.findings.map((f) => ({ ...f, evidence: f.evidence.map((e) => ({ ...e, side })) })) };
}
