import { describe, expect, it } from 'vitest';
import {
    ContextReconciler,
    RUN_CONTEXT_CONTRACT_VERSION,
    SUPERSEDED_MARKER,
    contextSubjectKey,
    renderPlatformContextSection,
    renderRunContext,
    summarizeBlocks,
    type CognitionClaim,
    type CognitionCommitPort,
    type CognitionCommitResult,
    type CognitionEvidenceGatherer,
    type RunContextBlock,
    type RunContextEnvelope,
} from './index.js';

/**
 * A faithful stand-in for `EvermindCognition`: the SAME
 * canonicalize → recall → evaluate → reconcile → write-through sequence over a Map, so
 * these tests pin the reconciler's reading of real verdicts rather than a mock's.
 */
class FakeCognition implements CognitionCommitPort {
    private readonly store = new Map<string, string>();
    private _version = 0;
    get version(): number {
        return this._version;
    }
    async commit(claim: CognitionClaim, gather?: CognitionEvidenceGatherer): Promise<CognitionCommitResult> {
        const key = claim.subjectKey.normalize('NFC').toLowerCase();
        const incumbent = this.store.get(key);
        if (incumbent == null) {
            this.store.set(key, claim.content);
            this._version++;
            return { verdict: 'augment', subjectKey: key, content: claim.content, evidence: [], version: this._version };
        }
        if (incumbent === claim.content) {
            return { verdict: 'confirm', subjectKey: key, content: claim.content, evidence: [], version: this._version };
        }
        const e = gather
            ? await gather({ claim, incumbent })
            : { supportsNew: true, notes: [] };
        if (e.supportsNew) {
            this.store.set(key, claim.content);
            this._version++;
            return { verdict: 'supersede', subjectKey: key, content: claim.content, superseded: incumbent, evidence: e.notes, version: this._version };
        }
        return { verdict: 'reject', subjectKey: key, content: incumbent, evidence: e.notes, version: this._version };
    }
}

const block = (over: Partial<RunContextBlock> & Pick<RunContextBlock, 'kind' | 'subject' | 'body'>): RunContextBlock => ({
    channel: 'user',
    order: 10,
    ...over,
});

const envelope = (blocks: RunContextBlock[], scope = 'task:7'): RunContextEnvelope => ({
    contractVersion: RUN_CONTEXT_CONTRACT_VERSION,
    scope,
    projectId: 3,
    taskId: 7,
    generatedAt: '2026-08-20T00:00:00.000Z',
    blocks,
});

describe('renderRunContext', () => {
    it('splits channels and joins user blocks with a rule', () => {
        const out = renderRunContext(envelope([
            block({ kind: 'task', subject: 'task:7', body: 'B', order: 20 }),
            block({ kind: 'prd', subject: 'prd:7', body: 'A', order: 10 }),
            block({ kind: 'tooling', subject: 'tooling:cloud', body: 'S', channel: 'system', order: 5 }),
        ]));
        expect(out.userContent).toBe('A\n\n---\n\nB');
        expect(out.systemPrompt).toBe('S');
    });

    it('drops empty bodies so a surface can emit blocks unconditionally', () => {
        const out = renderRunContext([
            block({ kind: 'prd', subject: 'prd:7', body: '' }),
            block({ kind: 'task', subject: 'task:7', body: 'only', order: 20 }),
        ]);
        expect(out.userContent).toBe('only');
    });
});

describe('renderPlatformContextSection', () => {
    it('omits the kinds a surface owns itself and names unchanged subjects', () => {
        const text = renderPlatformContextSection(
            envelope([
                block({ kind: 'workspace', subject: 'repo:x', body: 'REPO' }),
                block({ kind: 'strategy', subject: 'obj:1', body: 'OKR' }),
            ]),
            { omit: ['workspace'], unchanged: ['prd:7'] },
        );
        expect(text).toContain('OKR');
        expect(text).not.toContain('REPO');
        expect(text).toContain('Unchanged since your last turn (still in force, not repeated): prd:7.');
    });

    it('returns empty string when there is nothing to say', () => {
        expect(renderPlatformContextSection([])).toBe('');
    });
});

describe('ContextReconciler', () => {
    it('sends everything on the first pass, then elides what did not change', async () => {
        const reconciler = new ContextReconciler(new FakeCognition());
        const first = await reconciler.reconcile(envelope([
            block({ kind: 'prd', subject: 'prd:7', body: 'PRD v1', trustTier: 'tenant' }),
            block({ kind: 'governance', subject: 'gov:3', body: 'RULES', trustTier: 'tenant', order: 20 }),
        ]));
        expect(first.blocks.map((b) => b.verdict)).toEqual(['augment', 'augment']);
        expect(first.unchanged).toEqual([]);

        const second = await reconciler.reconcile(envelope([
            block({ kind: 'prd', subject: 'prd:7', body: 'PRD v1', trustTier: 'tenant' }),
            block({ kind: 'governance', subject: 'gov:3', body: 'RULES', trustTier: 'tenant', order: 20 }),
        ]));
        expect(second.blocks).toEqual([]);
        expect(second.unchanged).toEqual(['prd:7', 'gov:3']);
    });

    it('supersedes a changed block instead of concatenating a second belief', async () => {
        const reconciler = new ContextReconciler(new FakeCognition());
        await reconciler.reconcile(envelope([block({ kind: 'prd', subject: 'prd:7', body: 'PRD v1', trustTier: 'tenant' })]));
        const next = await reconciler.reconcile(envelope([block({ kind: 'prd', subject: 'prd:7', body: 'PRD v2', trustTier: 'tenant' })]));
        expect(next.blocks).toHaveLength(1);
        expect(next.blocks[0]?.verdict).toBe('supersede');
        expect(next.blocks[0]?.body).toContain(SUPERSEDED_MARKER);
        expect(next.blocks[0]?.body).toContain('PRD v2');
        expect(next.blocks[0]?.superseded).toBe('PRD v1');
    });

    it('refuses to let a lower-trust source overwrite a higher-trust belief', async () => {
        const reconciler = new ContextReconciler(new FakeCognition());
        await reconciler.reconcile(envelope([block({ kind: 'governance', subject: 'gov:3', body: 'TENANT RULES', trustTier: 'tenant' })]));
        const next = await reconciler.reconcile(envelope([block({ kind: 'governance', subject: 'gov:3', body: 'REPO SAYS OTHERWISE', trustTier: 'repository' })]));
        expect(next.blocks[0]?.verdict).toBe('reject');
        // The DELTA carries the incumbent — the contradiction is resolved, not appended.
        expect(next.blocks[0]?.body).toContain('TENANT RULES');
        expect(next.blocks[0]?.body).not.toContain('REPO SAYS OTHERWISE');
    });

    it('never elides a pinned block, even when unchanged', async () => {
        const reconciler = new ContextReconciler(new FakeCognition());
        const b = block({ kind: 'task', subject: 'task:7', body: 'THE GOAL', pinned: true, trustTier: 'tenant' });
        await reconciler.reconcile(envelope([b]));
        const second = await reconciler.reconcile(envelope([b]));
        expect(second.blocks).toHaveLength(1);
        expect(second.blocks[0]?.verdict).toBe('confirm');
        expect(second.unchanged).toEqual([]);
    });

    it('scopes subjects so two runs never share one incumbent', async () => {
        const reconciler = new ContextReconciler(new FakeCognition());
        const b = block({ kind: 'prd', subject: 'prd:7', body: 'PRD v1', trustTier: 'tenant' });
        await reconciler.reconcile(envelope([b], 'task:7'));
        const other = await reconciler.reconcile(envelope([b], 'session:abc'));
        expect(other.blocks[0]?.verdict).toBe('augment');
    });

    it('keeps confirmed blocks when the surface rebuilds its prompt every turn', async () => {
        // A system prompt is REPLACED, not accumulated — so a surface that rebuilds must
        // still receive the block, and gets the `unchanged` list purely as a signal.
        const reconciler = new ContextReconciler(new FakeCognition(), { elideUnchanged: false });
        const b = block({ kind: 'prd', subject: 'prd:7', body: 'PRD v1', trustTier: 'tenant' });
        await reconciler.reconcile(envelope([b]));
        const second = await reconciler.reconcile(envelope([b]));
        expect(second.blocks).toHaveLength(1);
        expect(second.blocks[0]?.verdict).toBe('confirm');
        expect(second.blocks[0]?.body).toBe('PRD v1');
        expect(second.unchanged).toEqual(['prd:7']);
    });

    it('degrades to the full block when cognition throws', async () => {
        const broken: CognitionCommitPort = {
            version: 0,
            commit: async () => {
                throw new Error('store offline');
            },
        };
        const out = await new ContextReconciler(broken).reconcile(
            envelope([block({ kind: 'prd', subject: 'prd:7', body: 'PRD v1' })]),
        );
        expect(out.blocks).toHaveLength(1);
        expect(out.blocks[0]?.body).toBe('PRD v1');
    });
});

describe('contextSubjectKey', () => {
    it('is scope-qualified and namespaced', () => {
        expect(contextSubjectKey('task:7', { kind: 'prd', subject: 'prd:7' })).toBe('runctx:task:7:prd:prd:7');
    });
});

describe('summarizeBlocks', () => {
    it('describes what a surface was given', () => {
        expect(summarizeBlocks([
            block({ kind: 'prd', subject: 'a', body: 'x' }),
            block({ kind: 'governance', subject: 'b', body: 'y' }),
            block({ kind: 'governance', subject: 'c', body: 'z' }),
        ])).toBe('PRD · Governance ×2');
        expect(summarizeBlocks([])).toBe('no context blocks');
    });
});
