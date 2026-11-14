/**
 * One root's incremental fact graph (PRD 41 §B1, §B5, §6 "Edit a file") — the L2 step's engine, pure over a facts port
 * (no `vscode`): RAW FileFacts v3 per file (extracted through the review's ONE extraction pool, `extractFactsJob`),
 * RESOLVED here against the root's LISTING and path aliases (agent-tools `resolveFileFacts`: a file's facts never depend on
 * which other files existed when it was parsed), memory's `updateFactGraph` evaluating the registered FactRules with
 * verifying traces and early cutoff, and the REAL changed fact kinds of every step (memory `factKindHashes`).
 *
 *   update — files whose content moved (hash '' = deleted). Only a path with a fact grammar reaches the port; any other
 *            file changed its `content` only. A port failure (`facts_grammar_unavailable`, a read) leaves the file
 *            un-applied: the next sync retries it;
 *   sync   — the plan's whole listing: extract what is new or moved since this index last applied it, drop what is gone;
 *   resolution — when the listing's path set (or the aliases) moves, every file is re-resolved (no parse) and only those
 *            whose resolution changed are re-applied, so an incremental index equals a scratch build of the same listing;
 *   knowledge rules — memory's generic finding rules and the code pack's (`KNOWLEDGE_FINDING_RULES`, `CODE_FACT_RULES`)
 *            are registered once the root's whole knowledge graph is handed in ({@link FactIndex.setKnowledge}), behind
 *            `knowledgeInputHash`: they rerun only when that hash moves.
 *
 * In memory for the session: a reload re-extracts once through `sync` (the B4 fact store will persist it).
 */
import { CODE_FACT_RULES, hasCandidateMounts, importResolver, isRouterFacts, NO_MODULE_ALIASES, resolutionKey, resolvedKey, resolveFileFacts, unresolveFileFacts, } from "@builderforce/agent-tools/knowledge";
import { hasFileFacts } from "@builderforce/agent-tools/node-file-facts";
import { FACT_KINDS, KNOWLEDGE_FINDING_RULES, canonicalJson, emptyFactGraph, importNeighbours, knowledgeInputHash, updateFactGraph, } from "@seanhogg/builderforce-memory/knowledge";
/**
 * A restored file's raw facts with its raw candidate mounts back in place: each candidate's registration `order` names
 * the mount or `use` its decision produced, which is replaced by the candidate.
 */
function withRawCandidates(unresolved, candidates) {
    const orders = new Set(candidates.map((c) => c.order));
    return {
        ...unresolved,
        mounts: [...(unresolved.mounts ?? []).filter((m) => !orders.has(m.order)), ...candidates],
        uses: (unresolved.uses ?? []).filter((u) => !orders.has(u.order)),
    };
}
const ALL = FACT_KINDS;
/** Extract failures that are final for the file's bytes (not retried). */
const FINAL_FACTS_ERRORS = /^file_facts_invalid_order\b/;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Runs `fn` over `items` with at most `width` in flight (a sliding window, never lockstep batches); stops taking new ones on abort. */
async function forEachLimited(items, width, signal, fn) {
    let next = 0;
    const lane = async () => { while (next < items.length && !signal?.aborted)
        await fn(items[next++]); };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, lane));
}
export class FactIndex {
    opts;
    graph = emptyFactGraph();
    /** RAW facts per path with facts (capped included). */
    raw = new Map();
    /** Each resolved path's resolution key, to re-apply only what a listing change moved. */
    keys = new Map();
    /** The content hash this index last applied per path, with facts or without. */
    hashes = new Map();
    /** The root's listed paths (what imports resolve against). */
    listing = new Set();
    aliases = NO_MODULE_ALIASES;
    knowledge;
    found = [];
    neighboursOf;
    /** Changes applied but not yet saved, by path, with the apply sequence that made them (re-applied on a save conflict). */
    unsaved = new Map();
    seq = 0;
    syncedOnce = false;
    /** Paths whose raw facts hold candidate mounts (re-decided on a router flip; kept in the candidate sidecar). */
    candidatePaths = new Set();
    candidateWrites = Promise.resolve();
    constructor(opts) {
        this.opts = opts;
    }
    /**
     * Resumes from the store (at activation): the stored graph becomes the index's, its facts are taken back to RAW
     * (`unresolveFileFacts`) with their resolution keys, and the listing and hashes start from its manifest. The next
     * `sync` then extracts only what moved since. Nothing stored (or a corrupt store, reset) ⇒ the index starts empty.
     */
    async restore() {
        const graph = await this.opts.store?.load();
        if (!graph)
            return false;
        this.graph = graph;
        const stored = (await this.opts.candidates?.load().catch((error) => { this.opts.log?.("fact candidates load", error); return undefined; })) ?? new Map();
        const withCandidates = [];
        for (const [path, entry] of graph.manifest) {
            const facts = graph.objects.get(entry.factsHash);
            const cand = stored.get(path);
            // The store's facts are DECIDED; the file's raw candidates (at this very content hash) are put back in their place.
            const raw = cand && cand.hash === facts.contentHash ? withRawCandidates(unresolveFileFacts(facts), cand.mounts) : unresolveFileFacts(facts);
            this.raw.set(path, raw);
            if (hasCandidateMounts(raw)) {
                withCandidates.push(path);
                this.candidatePaths.add(path);
            }
            this.keys.set(path, resolvedKey(facts));
            this.hashes.set(path, entry.contentHash);
            this.listing.add(path);
        }
        const byId = new Map();
        for (const row of graph.derived.values())
            for (const f of row.findings)
                if (!byId.has(f.id))
                    byId.set(f.id, f);
        this.found = [...byId.values()].sort((a, b) => compare(a.id, b.id));
        this.neighboursOf = undefined;
        // Re-decide every candidate against the RESTORED router set (a target may have changed after the decision was saved):
        // the same path as a router flip, no re-extraction.
        if (withCandidates.length > 0)
            this.apply(new Map(), new Map(), false, withCandidates);
        return true;
    }
    /** Resolves once every save (and candidate write) queued so far has settled (shutdown, tests). Writes nothing itself. */
    async flush() {
        await this.opts.store?.settled();
        await this.candidateWrites;
    }
    /** The current graph (manifest, objects, derived rows). */
    get current() { return this.graph; }
    /** The current findings of the registered rules. */
    findings() { return this.found; }
    /** The root's path aliases: a change re-resolves every file. */
    setAliases(aliases) {
        if (canonicalJson(aliases.scopes) === canonicalJson(this.aliases.scopes))
            return { changedPaths: [], changedKinds: [], trace: [] };
        this.aliases = aliases;
        return this.apply(new Map(), new Map(), true);
    }
    /**
     * The root's WHOLE knowledge graph (untruncated) with its partition registries and near-duplicate pairs: the knowledge
     * rules are registered from now on, behind its `knowledgeInputHash`. Returns the findings of every registered rule.
     */
    setKnowledge(knowledge) {
        const hash = knowledgeInputHash(knowledge);
        if (this.knowledge?.hash !== hash) {
            this.knowledge = { extra: { knowledge }, hash };
            this.apply(new Map(), new Map(), false);
        }
        return this.found;
    }
    /** Files whose content moved (`hash: ''` = deleted). */
    async update(files, signal) {
        const byPath = new Map(files.map((f) => [f.path, f.hash]));
        const before = this.listing;
        this.listing = new Set(before);
        for (const [path, hash] of byPath) {
            if (hash === "")
                this.listing.delete(path);
            else
                this.listing.add(path);
        }
        return this.extractAndApply(byPath, before, signal);
    }
    /** The plan's whole listing: extract what is new or moved since this index last applied it; drop what is gone. */
    sync(listing, signal) {
        const before = this.listing;
        this.listing = new Set(listing.map((f) => f.path));
        const moved = new Map(listing.filter((f) => this.hashes.get(f.path) !== f.hash).map((f) => [f.path, f.hash]));
        for (const p of this.hashes.keys())
            if (!this.listing.has(p))
                moved.set(p, "");
        return this.extractAndApply(moved, before, signal).then((u) => {
            if (!signal?.aborted)
                this.syncedOnce = true;
            return u;
        });
    }
    /** Whether a whole listing has been synced this session (what the view's findings provider waits for). */
    get synced() { return this.syncedOnce; }
    /** Whether a file is a ROUTER module by its current facts (routes, uses or mounts): what decides a candidate mount. */
    isRouterFile(path) {
        const f = this.raw.get(path);
        return f !== undefined && isRouterFacts(f);
    }
    /** Removes the store's unreferenced objects (`FactGraphStore.sweep`: once per session, only when the store moved). */
    sweep() {
        return this.opts.store?.sweep() ?? Promise.resolve(0);
    }
    /** The files within `hops` import hops of `seeds` (the seeds included), by the current resolved imports. */
    near(seeds, hops = 2) {
        this.neighboursOf ??= importNeighbours(new Map([...this.graph.manifest].map(([p, e]) => [p, this.graph.objects.get(e.factsHash)])));
        const seen = new Set(seeds);
        let frontier = [...seen];
        for (let h = 0; h < hops && frontier.length > 0; h++) {
            const next = [];
            for (const p of frontier)
                for (const n of this.neighboursOf(p))
                    if (!seen.has(n)) {
                        seen.add(n);
                        next.push(n);
                    }
            frontier = next;
        }
        return seen;
    }
    async extractAndApply(files, listingBefore, signal) {
        const hasFacts = this.opts.hasFacts ?? hasFileFacts;
        const rawChanged = new Map();
        const applied = new Map();
        const work = [...files].sort((a, b) => compare(a[0], b[0]));
        await forEachLimited(work, this.opts.concurrency?.() ?? 4, signal, async ([path, hash]) => {
            if (hash === "" || !hasFacts(path)) {
                rawChanged.set(path, null);
                applied.set(path, hash);
                return;
            }
            try {
                rawChanged.set(path, (await this.opts.facts(path, hash, signal)) ?? null);
                applied.set(path, hash);
            }
            catch (error) {
                this.opts.log?.(`facts ${path}`, error);
                // A producer bug the same bytes always repeat (`file_facts_invalid_order`): a FINAL failure of this file — it has
                // no facts at this hash. Anything else (`facts_grammar_unavailable`, a read) is transient: left un-applied, retried.
                if (FINAL_FACTS_ERRORS.test(error instanceof Error ? error.message : String(error))) {
                    rawChanged.set(path, null);
                    applied.set(path, hash);
                }
            }
        });
        const listingMoved = listingBefore.size !== this.listing.size || [...this.listing].some((p) => !listingBefore.has(p));
        return this.apply(rawChanged, applied, listingMoved);
    }
    apply(rawChanged, applied, reresolveAll, alsoResolve = []) {
        const resolve = importResolver((f) => this.listing.has(f), this.aliases);
        const isRouterFile = (file) => this.isRouterFile(file);
        const changes = [];
        // A file that became (or stopped being) a router module re-decides every candidate mount of the files that use it.
        let routerFlipped = false;
        for (const [path, raw] of rawChanged) {
            const was = this.isRouterFile(path);
            if (raw === null) {
                this.raw.delete(path);
                this.keys.delete(path);
                changes.push({ path, facts: null });
            }
            else
                this.raw.set(path, raw);
            if (was !== this.isRouterFile(path))
                routerFlipped = true;
        }
        this.persistCandidates(rawChanged);
        const toResolve = reresolveAll ? [...this.raw.keys()]
            : [...new Set([
                    ...[...rawChanged.keys()].filter((p) => this.raw.has(p)),
                    ...alsoResolve.filter((p) => this.raw.has(p)),
                    ...(routerFlipped ? [...this.candidatePaths].filter((p) => this.raw.has(p)) : []),
                ])];
        for (const path of toResolve) {
            const raw = this.raw.get(path);
            const key = resolutionKey(path, raw, resolve, isRouterFile);
            if (!rawChanged.has(path) && this.keys.get(path) === key)
                continue;
            this.keys.set(path, key);
            changes.push({ path, facts: resolveFileFacts(path, raw, resolve, isRouterFile) });
        }
        const before = this.graph.manifest;
        const rowsBefore = this.graph.derived.size;
        const result = updateFactGraph(this.graph, changes, this.rules(), this.ruleOpts());
        this.graph = result.graph;
        this.found = result.findings;
        // Nothing to write when no file moved, no rule reran and no row went (an early-cutoff step): no generation is spent.
        if (result.changed.length > 0 || result.trace.some((t) => t.outcome === "ran") || result.graph.derived.size !== rowsBefore)
            this.persist(changes);
        const kinds = new Set();
        const paths = new Set(result.changed);
        for (const p of result.changed) {
            const was = before.get(p)?.kinds, now = result.graph.manifest.get(p)?.kinds;
            if (!was || !now) {
                for (const k of ALL)
                    kinds.add(k);
                continue;
            }
            for (const k of ALL)
                if (was[k] !== now[k])
                    kinds.add(k);
        }
        // A file without facts (a doc, an asset) whose content moved changed its content only.
        for (const [path, hash] of applied) {
            const prior = this.hashes.get(path);
            if (hash === "")
                this.hashes.delete(path);
            else
                this.hashes.set(path, hash);
            if (prior !== hash && !result.graph.manifest.has(path) && !before.has(path) && (prior !== undefined || hash !== "")) {
                kinds.add("content");
                paths.add(path);
            }
        }
        // The import graph moves only with `structure`: the near level's neighbours are re-read then, never on a body edit.
        if (kinds.has("structure"))
            this.neighboursOf = undefined;
        return { changedPaths: [...paths].sort(compare), changedKinds: ALL.filter((k) => kinds.has(k)), trace: result.trace };
    }
    /** Keeps the candidate sidecar in step with the raw facts: a file's candidates put at its hash, gone ones deleted. */
    persistCandidates(rawChanged) {
        const puts = [];
        const deletes = [];
        for (const [path, raw] of rawChanged) {
            if (raw && hasCandidateMounts(raw)) {
                this.candidatePaths.add(path);
                puts.push({ path, hash: raw.contentHash, mounts: raw.mounts ?? [] });
            }
            else if (this.candidatePaths.delete(path))
                deletes.push(path);
        }
        const port = this.opts.candidates;
        if (!port || (puts.length === 0 && deletes.length === 0))
            return;
        this.candidateWrites = this.candidateWrites.then(() => port.write(puts, deletes)).catch((error) => this.opts.log?.("fact candidates write", error));
    }
    /** The registered rules: the file-facts ones, plus the knowledge ones once a knowledge graph was handed in. */
    rules() {
        return [...(this.opts.rules ?? []), ...(this.knowledge ? this.opts.knowledgeRules ?? [...KNOWLEDGE_FINDING_RULES, ...CODE_FACT_RULES] : [])];
    }
    ruleOpts() {
        return this.knowledge ? { extra: this.knowledge.extra, extraHashes: { knowledge: this.knowledge.hash } } : {};
    }
    /** Saves the delta (serialized); on a conflict the unsaved changes are re-applied on what the other writer left. */
    persist(changes) {
        const store = this.opts.store;
        if (!store)
            return;
        for (const change of changes)
            this.unsaved.set(change.path, { change, seq: ++this.seq });
        const upTo = this.seq;
        void store.save({
            current: () => this.graph,
            reapply: (loaded) => updateFactGraph(loaded, [...this.unsaved.values()].map((u) => u.change), this.rules(), this.ruleOpts()).graph,
            adopt: (graph) => { this.graph = graph; this.neighboursOf = undefined; },
            saved: () => { for (const [path, u] of this.unsaved)
                if (u.seq <= upTo)
                    this.unsaved.delete(path); },
        });
    }
}
//# sourceMappingURL=factIndex.js.map