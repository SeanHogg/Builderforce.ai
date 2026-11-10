/**
 * candidateMounts.test.ts — an Express `use('/path', imported)` is a mount or a middleware by the TARGET's facts, never by
 * its name (PRD 41 §C5.1): the extractor records a candidate, and resolution makes it a mount when the imported file is a
 * router module (it declares routes, uses or mounts), else a `use` of the binding at that path.
 */

import { describe, expect, it } from 'vitest';
import { extractFileFacts } from '../../node-file-facts.js';
import { importResolver } from './importResolver.js';
import { CANDIDATE_MOUNT, hasCandidateMounts, isRouterFacts, resolveFileFacts } from './resolveFacts.js';

const APP = [
    "const express = require('express');",
    "const users = require('./users');",
    "const audit = require('./audit');",
    "const app = express();",
    "app.use('/users', users);",
    "app.use('/audit/*', audit);",
    "app.get('/health', (req, res) => res.send('ok'));",
    '',
].join('\n');
const resolve = importResolver((f) => ['src/app.js', 'src/users.js', 'src/audit.js'].includes(f));

describe('candidate mounts', () => {
    it('the extractor records an imported Express `use` target as a CANDIDATE (names never decide)', async () => {
        const raw = (await extractFileFacts('src/app.js', APP))!;
        expect(hasCandidateMounts(raw)).toBe(true);
        expect(raw.mounts!.every((m) => m.target.startsWith(CANDIDATE_MOUNT))).toBe(true);
        expect(raw.uses).toEqual([]);
    });

    it('a router-module target becomes a mount; a non-router target a `use` of the binding at that path', async () => {
        const raw = (await extractFileFacts('src/app.js', APP))!;
        const resolved = resolveFileFacts('src/app.js', raw, resolve, (f) => f === 'src/users.js');
        expect(resolved.mounts).toEqual([{ prefix: '/users', target: './users', order: 0, router: 'app' }]);
        expect(resolved.uses).toEqual([{ path: '/audit/*', guards: ['audit'], order: 1, router: 'app' }]);
    });

    it('with no router facts known (or the target unresolved) every candidate is middleware', async () => {
        const raw = (await extractFileFacts('src/app.js', APP))!;
        const resolved = resolveFileFacts('src/app.js', raw, importResolver(() => false), () => true);
        expect(resolved.mounts).toEqual([]);
        expect(resolved.uses?.map((u) => u.guards)).toEqual([['users'], ['audit']]);
    });

    it('isRouterFacts: routes, uses or mounts make a router module', async () => {
        expect(isRouterFacts((await extractFileFacts('src/users.js', "const r = require('express').Router();\nr.get('/:id', (q, s) => s.json(q.params));\nmodule.exports = r;\n"))!)).toBe(true);
        expect(isRouterFacts((await extractFileFacts('src/audit.js', 'module.exports = (req, res, next) => next();\n'))!)).toBe(false);
    });
});
