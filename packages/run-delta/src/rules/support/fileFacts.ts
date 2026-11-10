/**
 * rules/support/fileFacts.ts — how a rule reads the per-file FileFacts v3 of a side (PRD 41 §B3, §C5.1, §C6.1, §C8.2):
 * the seam that lets a rule use entry points with guard chains, test facts, calls (awaited / in loop) and exports with
 * signature hashes instead of re-reading text. Facts are optional (`SideFacts.fileFacts`): every accessor answers
 * `undefined` when the host supplied none for that file, and the rule keeps its text path.
 *
 * Keys are the LOGICAL (after-side) path, as `RuleInput.before` / `after` are; a renamed file's before facts are looked
 * up under its before-side path (`SideText.path`).
 */

import {
    effectiveGuards, rootRouters,
    type CallFact, type EffectiveEntryPoint, type FileFacts, type MountFact, type MountTarget, type ResolvedMount, type TestFacts,
} from '@seanhogg/builderforce-memory/knowledge';
import type { RuleInput } from '../../contract.js';

export type Side = 'before' | 'after';

/** The FileFacts of one changed file on one side, by its logical path; undefined when the host has none. */
export function sideFileFacts(input: RuleInput, side: Side, logicalPath: string): FileFacts | undefined {
    const facts = (side === 'before' ? input.beforeFacts : input.afterFacts).fileFacts;
    if (!facts) return undefined;
    const sidePath = (side === 'before' ? input.before : input.after).get(logicalPath)?.path ?? logicalPath;
    return facts.get(sidePath) ?? facts.get(logicalPath);
}

/** Whether both sides of a file have facts from the SAME extractor (C9: facts of different extractors are never compared). */
export function comparableFacts(input: RuleInput, logicalPath: string): { before: FileFacts; after: FileFacts } | undefined {
    const before = sideFileFacts(input, 'before', logicalPath);
    const after = sideFileFacts(input, 'after', logicalPath);
    return before && after && before.extractor === after.extractor && before.factsVersion === after.factsVersion ? { before, after } : undefined;
}

/** A side's EFFECTIVE entry points, by the file that registers each handler (computed once per side's facts map). */
const effectiveBySide = new WeakMap<ReadonlyMap<string, FileFacts>, Map<string, EffectiveEntryPoint[]>>();

/** The side file a mount names: a specifier, resolved through the mounting file's own resolved imports. */
function mountTarget(facts: ReadonlyMap<string, FileFacts>, from: string, mount: MountFact): MountTarget | undefined {
    const file = facts.get(from)?.imports.find((i) => i.specifier === mount.target)?.resolved;
    return file !== undefined && facts.has(file) ? { path: file } : undefined;
}

/** The resolved mounts of `path`, recursively (memory's `ResolvedMount` tree); a cycle stops at the file already on the stack. */
function resolvedMounts(facts: ReadonlyMap<string, FileFacts>, path: string, stack: ReadonlySet<string>): ResolvedMount[] {
    const out: ResolvedMount[] = [];
    for (const m of facts.get(path)?.mounts ?? []) {
        const target = mountTarget(facts, path, m);
        if (!target || stack.has(target.path)) continue;
        out.push({ target: m.target, path: target.path, facts: facts.get(target.path)!, mounts: resolvedMounts(facts, target.path, new Set([...stack, target.path])) });
    }
    return out;
}

/**
 * Every effective entry point of a side, grouped by the file registering the handler: memory's `effectiveGuards` from each
 * ROOT router (`rootRouters`), so a route's guards include the `use` registrations before it and every mounting router's
 * (and a mounted route reads its prefix-joined key). The ONE way a rule reads route guards: never `entryPoints[].guards`.
 */
function effectiveOf(facts: ReadonlyMap<string, FileFacts>): Map<string, EffectiveEntryPoint[]> {
    let byFile = effectiveBySide.get(facts);
    if (byFile) return byFile;
    byFile = new Map();
    for (const { path, router } of rootRouters(facts, (from, m) => mountTarget(facts, from, m))) {
        const result = effectiveGuards(facts.get(path)!, resolvedMounts(facts, path, new Set([path])), { path, router });
        for (const e of result.entryPoints) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
    }
    effectiveBySide.set(facts, byFile);
    return byFile;
}

/**
 * The EFFECTIVE entry points a file registers on one side (`effectiveGuards`: inline guards, prior `use`s, mounting routers'
 * guards; mounted routes keyed under their prefix). Undefined when the host supplied no facts for the file.
 */
export function entryPointsOf(input: RuleInput, side: Side, path: string): readonly EffectiveEntryPoint[] | undefined {
    const facts = (side === 'before' ? input.beforeFacts : input.afterFacts).fileFacts;
    if (!facts || !sideFileFacts(input, side, path)) return undefined;
    const sidePath = (side === 'before' ? input.before : input.after).get(path)?.path ?? path;
    return effectiveOf(facts).get(facts.has(sidePath) ? sidePath : path) ?? [];
}
/**
 * The effective entry points whose guard chain runs THROUGH a file on one side: the ones it registers plus every
 * route mounted beneath it (a mounted route's `chain` names each mounting file). A change to a mounting file's `use`s
 * moves the guards of routes registered in files the run never touched. Undefined when the file has no facts.
 */
export function entryPointsThrough(input: RuleInput, side: Side, path: string): readonly EffectiveEntryPoint[] | undefined {
    const facts = (side === 'before' ? input.beforeFacts : input.afterFacts).fileFacts;
    if (!facts || !sideFileFacts(input, side, path)) return undefined;
    const sidePath = (side === 'before' ? input.before : input.after).get(path)?.path ?? path;
    const key = facts.has(sidePath) ? sidePath : path;
    return [...effectiveOf(facts).values()].flat().filter((e) => e.file === key || e.chain.includes(key));
}

/** The extracted test facts of a file (named apart from `support/testFacts.ts`'s text-derived `testFactsOf`). */
export const factsTestFactsOf = (input: RuleInput, side: Side, path: string): TestFacts | undefined => sideFileFacts(input, side, path)?.testFacts;
export const callsOf = (input: RuleInput, side: Side, path: string): readonly CallFact[] | undefined => sideFileFacts(input, side, path)?.calls;
