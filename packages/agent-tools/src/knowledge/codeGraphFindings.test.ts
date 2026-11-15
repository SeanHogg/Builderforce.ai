import { describe, expect, it } from 'vitest';
import { createCodePack } from './codePack.js';
import { codeGraphFindings } from './codeGraphFindings.js';
import { codeFileNode, rootLevelExtracted } from './codeNodes.js';
import { knowledgePacks } from './knowledgePacks.js';

const ROOT = 'r';

/** Two files with an import between them: a folder-layered graph with one placed file and a references edge. */
function twoFileExtracted() {
    const a = codeFileNode(ROOT, 'src/boot.ts', { sourceHash: 'h:boot', badges: { language: 'js', symbols: 1, entry: 1 } });
    const b = codeFileNode(ROOT, 'src/core.ts', { sourceHash: 'h:core', badges: { language: 'js', symbols: 1 } });
    return [
        rootLevelExtracted('t', a, []),
        rootLevelExtracted('t', b, []),
        rootLevelExtracted('t', codeFileNode(ROOT, 'src/boot.ts'), [{ from: a.ref, to: b.ref, kind: 'references', weight: 1, origin: 'extracted' }]),
    ];
}

describe('codeGraphFindings', () => {
    it('answers the graph findings and the layer each file was placed in', () => {
        const out = codeGraphFindings(ROOT, twoFileExtracted(), createCodePack().partitions!);
        // A Map of root-relative path → layer, exactly what the code actions layer their verdicts with.
        expect(out.placed).toBeInstanceOf(Map);
        expect(out.placed.get('src/boot.ts')).toBe('entry');
        expect(out.placed.get('src/core.ts')).toBe('presentation');
        expect(Array.isArray(out.findings)).toBe(true);
    });

    it('drives the same graph buildCodeGraph produces over knowledgePacks (no per-host divergence)', () => {
        const extracted = twoFileExtracted();
        const viaPacks = codeGraphFindings(ROOT, extracted, createCodePack().partitions!);
        const viaDefault = codeGraphFindings(ROOT, extracted, knowledgePacks()[0]!.partitions!);
        expect(viaDefault.placed.get('src/boot.ts')).toBe(viaPacks.placed.get('src/boot.ts'));
        expect(viaDefault.placed.get('src/core.ts')).toBe(viaPacks.placed.get('src/core.ts'));
    });
});
