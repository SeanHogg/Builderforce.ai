import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { surfaceFixture } from '../../testing';
import { buildLines } from '../lines';
import { buildStations } from '../stations';
import { groupTermini, terminusExternals, terminusFor, terminusHints, terminusText } from './termini';

const graph = surfaceFixture();
const model = buildStations(graph);
const lines = buildLines(graph, model);

describe('terminusFor', () => {
    it('names a data store or service from the words around it, and falls back to the generic kind', () => {
        expect(terminusFor('data', undefined, ['db/postgres.ts'])).toMatchObject({ glyph: 'tank', name: 'postgres' });
        expect(terminusFor('data', undefined, ['storage/r2.ts'])).toMatchObject({ glyph: 'tank', name: 'kv' });
        expect(terminusFor('external', undefined, ['clients/openai.ts'])).toMatchObject({ glyph: 'globe', name: 'llm' });
        expect(terminusFor('external', undefined, ['clients/octokit.ts'])).toMatchObject({ glyph: 'globe', name: 'github' });
        expect(terminusFor('data', undefined, ['thing.ts'])).toMatchObject({ glyph: 'tank', name: null });
        expect(terminusFor('external', undefined, ['thing.ts'])).toMatchObject({ glyph: 'globe', name: null });
    });
    it('marks a line that ends nowhere as a dead end, until a finding reports it', () => {
        expect(terminusFor('end', { findingIds: [] }, [])).toMatchObject({ glyph: 'cross', deadEnd: true, reported: false });
        expect(terminusFor('end', { findingIds: ['f'] }, [])).toMatchObject({ glyph: 'box', deadEnd: false, reported: true });
    });
});

describe('the externals badge', () => {
    it('names a terminus from what the files import, before their names and paths', () => {
        // The path says kv; the imports say Postgres: the imports win.
        expect(terminusFor('data', undefined, ['storage/r2.ts'], ['postgres'])).toMatchObject({ glyph: 'tank', name: 'postgres' });
        expect(terminusFor('external', undefined, ['thing.ts'], ['github'])).toMatchObject({ glyph: 'globe', name: 'github' });
        expect(terminusFor('data', undefined, ['storage/r2.ts'], ['unknown'])).toMatchObject({ name: 'kv' });
    });
    it('reads the badge of every file of the station, and ignores a station that has none', () => {
        const repos = model.stations.find((s) => s.name === 'repositories')!;
        const tagged = { ...graph, nodes: graph.nodes.map((n) => (n.ref === 'src:sys::db/repo.ts' ? { ...n, badges: { ...n.badges, externals: 'llm, postgres' } } : n)) };
        expect(terminusExternals(repos, tagged).sort()).toEqual(['llm', 'postgres']);
        expect(terminusExternals(repos, graph)).toEqual([]);
        // A data store that imports an LLM SDK and Postgres is named for the tank it is, not for the globe.
        expect(groupTermini(lines.lines, model.byId, tagged)[0]).toMatchObject({ kind: 'data', name: 'postgres', glyph: 'tank' });
    });
    it('only lets a rule of the line\'s own kind name it', () => {
        // A data store whose files import only an LLM SDK has no tank to be named by: it stays a plain data store.
        expect(terminusFor('data', undefined, ['db/repo.ts'], ['llm'])).toMatchObject({ glyph: 'tank', name: null });
        expect(terminusFor('external', undefined, ['clients/x.ts'], ['postgres'])).toMatchObject({ glyph: 'globe', name: null });
        // cache-stripe-webhook.ts: a data store reads "cache" (KV), an outside service reads "stripe".
        const hints = ['cache-stripe-webhook.ts'];
        expect(terminusFor('data', undefined, hints)).toMatchObject({ glyph: 'tank', name: 'kv' });
        expect(terminusFor('external', undefined, hints)).toMatchObject({ glyph: 'globe', name: 'stripe' });
    });
});

describe('terminusHints and groupTermini', () => {
    it('reads the station name, file paths and the imports badge', () => {
        const withImports = { ...graph, nodes: graph.nodes.map((n) => (n.ref === 'src:sys::db/repo.ts' ? { ...n, badges: { ...n.badges, imports: 'pg,drizzle-orm' } } : n)) };
        const repos = model.stations.find((s) => s.name === 'repositories')!;
        const hints = terminusHints(repos, withImports);
        expect(hints).toContain('repositories');
        expect(hints).toContain('db/repo.ts');
        expect(hints).toContain('pg,drizzle-orm');
    });
    it('draws one terminus per station, shared by the lines that end there', () => {
        const termini = groupTermini(lines.lines, model.byId, graph);
        expect(termini).toHaveLength(1);
        expect(termini[0]!.lineIds).toHaveLength(2);
        expect(terminusText(termini[0]!, L)).toBe(L.surface.terminus.data);
    });
    it('says the words of a named terminus, a dead end and a reported one', () => {
        const base = { stationId: 's', lineIds: ['l'], kind: 'data' as const };
        expect(terminusText({ ...base, glyph: 'tank', name: 'postgres', deadEnd: false, reported: false }, L)).toBe(L.surface.map.names.postgres);
        expect(terminusText({ ...base, kind: 'end', glyph: 'cross', name: null, deadEnd: true, reported: false }, L)).toBe(L.surface.map.deadEnd);
        expect(terminusText({ ...base, kind: 'end', glyph: 'box', name: null, deadEnd: false, reported: true }, L)).toBe(L.surface.map.reported);
    });
});
