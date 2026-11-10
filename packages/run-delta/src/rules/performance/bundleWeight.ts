/**
 * rules/performance/bundleWeight.ts — `bundle-weight` (performance, warn; C6.1, the static half): a
 * browser module (`'use client'`, webview, `*.client.*`) of the run imports a server-heavy package
 * ({@link HEAVY_SERVER_PACKAGES}), which ships it into the client bundle. One finding per (file,
 * package); type-only imports are erased and never count.
 *
 * The other half of C6.1 `bundle-weight` — a new dependency's installed size from the lockfile and the
 * local registry cache — reads the filesystem, so it is an L3 analyzer, not a content rule.
 */

import type { DeltaRule } from '../../contract.js';
import { isTestPath, type TextView } from '../support/files.js';
import { importsOf, packageOf } from '../support/imports.js';
import { layerOf } from '../support/layers.js';
import { stateSides, type Hit } from '../support/stateRule.js';

/** Packages that are server-only or far too heavy for a client bundle (rule data). */
export const HEAVY_SERVER_PACKAGES: readonly string[] = [
    '@aws-sdk/client-s3', '@google-cloud/storage', '@prisma/client', 'aws-sdk', 'canvas', 'esbuild', 'firebase-admin',
    'googleapis', 'jsdom', 'knex', 'lodash', 'moment', 'mongoose', 'mysql2', 'pg', 'playwright', 'puppeteer', 'sequelize',
    'sharp', 'sqlite3', 'typeorm', 'typescript', 'webpack',
];
const HEAVY: ReadonlySet<string> = new Set(HEAVY_SERVER_PACKAGES);

function hitsOf(view: TextView): Hit[] {
    if (layerOf(view) !== 'browser') return [];
    return importsOf(view)
        .filter((i) => !i.typeOnly && HEAVY.has(packageOf(i.specifier)) && !i.specifier.startsWith('node:'))
        .map((i) => ({ offset: i.offset, length: i.length, key: packageOf(i.specifier), params: { module: packageOf(i.specifier) } }));
}

export const bundleWeight: DeltaRule = {
    id: 'bundle-weight',
    version: 1,
    dimension: 'performance',
    reads: ['content'],
    derive(input) {
        return stateSides(bundleWeight, { files: (p) => !isTestPath(p), hits: hitsOf, severity: 'warn', granularity: 'file' }, input);
    },
};
