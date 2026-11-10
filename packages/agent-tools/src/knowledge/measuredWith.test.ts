import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { knowledgeComparability, knowledgeMeasuredWith, knowledgeSideMeta, MEASURED_UNKNOWN, PACK_TOOL_PREFIX } from './measuredWith.js';

describe('the view reads these codes (knowledge-graph-view `compareReasons.ts`, which cannot import this package)', () => {
    it('states the same pack prefix and unknown-measurement code', () => {
        const view = readFileSync(fileURLToPath(new URL('../../../knowledge-graph-view/src/compareReasons.ts', import.meta.url)), 'utf8');
        expect(view).toContain(`export const PACK = '${PACK_TOOL_PREFIX}';`);
        expect(view).toContain(`'${MEASURED_UNKNOWN}': 'compareReasonMeasuredUnknown'`);
    });
});

describe('knowledgeMeasuredWith (PRD 41 §C9)', () => {
    it('states the analyzers only for a code-pack review that runs them', () => {
        expect(knowledgeMeasuredWith(['code']).toolVersions).toMatchObject({ knip: expect.any(String), jscpd: expect.any(String), 'dependency-cruiser': expect.any(String) });
        expect(knowledgeMeasuredWith(['docs']).toolVersions).toEqual({});
        expect(knowledgeMeasuredWith(['code'], { analyzers: false }).toolVersions).toEqual({});
    });
});

describe('knowledgeSideMeta / knowledgeComparability', () => {
    it('keeps packs and analyzers apart in tools (a pack is `pack:<id>`), and states the extractor and hash rule only when known', () => {
        expect(knowledgeSideMeta({ rootId: 'ws', packs: ['code', 'code'] })).toEqual({ scope: 'ws', tools: { 'pack:code': '' } });
        expect(knowledgeSideMeta({ rootId: 'ws', packs: [], contentHashRule: 'eol-lf@1' })).toEqual({ scope: 'ws', tools: {}, contentHashRule: 'eol-lf@1' });
        expect(knowledgeSideMeta({ rootId: 'ws', packs: ['code'], measured: { extractorVersion: '5', toolVersions: { knip: '5.30.0' } } }))
            .toEqual({ scope: 'ws', tools: { 'pack:code': '', knip: '5.30.0' }, extractorVersion: '5' });
    });

    it('a pack and an analyzer of the same name never read as one tool', () => {
        const before = { rootId: 'ws', packs: ['knip'], measured: { extractorVersion: '5', toolVersions: {} } };
        const after = { rootId: 'ws', packs: [], measured: { extractorVersion: '5', toolVersions: { knip: '' } } };
        expect(knowledgeComparability(before, after).reasons).toEqual(['tool-missing:knip', 'tool-missing:pack:knip']);
    });

    it('an unmeasured side (a review stored before versions were recorded) is never comparable — to a measured one, or to another unknown', () => {
        const measured = knowledgeMeasuredWith(['docs']);
        expect(knowledgeComparability({ rootId: 'ws', packs: ['docs'] }, { rootId: 'ws', packs: ['docs'], measured }))
            .toEqual({ comparable: false, reasons: ['extractor-version-changed', MEASURED_UNKNOWN] });
        expect(knowledgeComparability({ rootId: 'ws', packs: ['docs'] }, { rootId: 'ws', packs: ['docs'] })).toEqual({ comparable: false, reasons: [MEASURED_UNKNOWN] });
        expect(knowledgeComparability({ rootId: 'ws', packs: ['docs'], measured }, { rootId: 'ws', packs: ['docs'], measured })).toEqual({ comparable: true, reasons: [] });
    });
});
