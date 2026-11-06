import { describe, expect, it } from 'vitest';
import { CLASS_REF, FAIL_REF, RUN_REF, USE_CASE, withSymbols } from './testFixtures';
import { isErrorish, membersOfClass, parentName, shortName, symbolSort, symbolsOf, symbolsOfFile } from './symbols';

const graph = withSymbols();
const symbols = symbolsOf(graph);
const byRef = (ref: string) => symbols.find((n) => n.ref === ref)!;

describe('symbols', () => {
    it('reads the sort from the badge, else from the name', () => {
        expect(symbolSort(byRef(CLASS_REF))).toBe('class');
        expect(symbolSort(byRef(RUN_REF))).toBe('method');
        const bare = (label: string) => ({ ...byRef(CLASS_REF), label, badges: undefined });
        expect(symbolSort(bare('Widget'))).toBe('class');
        expect(symbolSort(bare('widget'))).toBe('function');
        expect(symbolSort(bare('Widget.render'))).toBe('method');
    });
    it('finds a method\'s class and a class\'s methods', () => {
        expect(parentName(byRef(RUN_REF))).toBe('UseCase');
        expect(membersOfClass(symbols, byRef(CLASS_REF)).map((n) => n.ref)).toEqual([RUN_REF, FAIL_REF]);
        expect(shortName(byRef(RUN_REF))).toBe('run');
    });
    it('lists the symbols of a file and knows an error symbol', () => {
        expect(symbolsOfFile(symbols, USE_CASE)).toHaveLength(3);
        expect(symbolsOfFile(symbols, 'src:sys::web/page.tsx')).toHaveLength(0);
        expect(isErrorish(byRef(FAIL_REF))).toBe(true);
        expect(isErrorish(byRef(RUN_REF))).toBe(false);
    });
});
