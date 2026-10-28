import { describe, expect, it } from 'vitest';
import {
    CHOOSE_FOLDER_LABEL_KEY, KNOWLEDGE_GRAPH, KNOWLEDGE_PREFETCH_ROWS, KNOWLEDGE_REVIEW_DIR, OPEN_KNOWLEDGE_REVIEW_COMMAND,
    reviewInViewExecutor, withKnowledgeRows, type KnowledgeRowsHost, type PortWithRows,
} from './knowledgeRows.js';
import type { PrefetchRow } from './contract.js';

const signal = new AbortController().signal;

describe('the knowledge rows on every host (PRD 38 §3.1)', () => {
    it('are offered on the web as well as the editor and on-prem', () => {
        for (const row of KNOWLEDGE_PREFETCH_ROWS) expect(row.surfaces).toEqual(expect.arrayContaining(['vscode', 'onprem', 'web']));
    });

    it('answer /review in a view with the launcher chip, naming the folder asked for', async () => {
        const out = await reviewInViewExecutor().run('review ./contracts', signal);
        expect(out).toMatchObject({ actionId: KNOWLEDGE_REVIEW_DIR, data: { dir: 'contracts' } });
        expect(out?.chips).toEqual([{ labelKey: CHOOSE_FOLDER_LABEL_KEY, command: OPEN_KNOWLEDGE_REVIEW_COMMAND, args: { dir: 'contracts' } }]);
    });

    it('merge into a host port once: one registry through the host validator, the executors over the host', async () => {
        const existing: PrefetchRow = {
            id: 'lint.check', kind: 'answer', sideEffect: 'read', surfaces: ['vscode'], examples: ['lint'], budgetMs: 1, labelKey: 'x',
        };
        const host: KnowledgeRowsHost = {
            openReview: async () => null,
            rootId: async () => 'r',
            showGraph: async (rootId) => ({ text: `graph ${rootId}` }),
        };
        let validated = 0;
        const base: PortWithRows & { ports: { surface: string } } = {
            registry: [existing], executors: { 'lint.check': { run: async () => undefined } }, ports: { surface: 'vscode' },
        };
        const port = withKnowledgeRows(
            base,
            host,
            (rows) => { validated += 1; return Object.freeze([...rows]); },
        );
        expect(validated).toBe(1);
        expect(port.registry.map((r) => r.id)).toEqual(['lint.check', ...KNOWLEDGE_PREFETCH_ROWS.map((r) => r.id)]);
        expect(port.ports).toEqual({ surface: 'vscode' });
        expect((await port.executors[KNOWLEDGE_GRAPH]!.run('/graph', signal))?.text).toBe('graph r');
    });
});
