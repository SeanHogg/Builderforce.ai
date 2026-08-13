import { describe, expect, it } from 'vitest';
import {
  columnLetters,
  columnIndex,
  evaluateFormula,
  expandRange,
  expressionReferences,
  isFormulaError,
  parseExpression,
  type FormulaValue,
} from './canvasFormula';

const CELLS: Record<string, FormulaValue> = { A1: 10, A2: 20, A3: 30, B1: 2, B2: 4, C1: 'text', D1: null };
const context = { cell: (ref: string) => CELLS[ref] ?? null, name: (name: string) => (name === 'revenue' ? [100, 200] : { error: 'NAME' as const, message: name }) };

describe('parseExpression', () => {
  it('honours precedence and right-associative ^', () => {
    expect(evaluateFormula('=1+2*3')).toBe(7);
    expect(evaluateFormula('=2^3^2')).toBe(512);
    expect(evaluateFormula('=(1+2)*3')).toBe(9);
  });

  it('reads a percent literal as a fraction', () => {
    expect(evaluateFormula('=20%')).toBeCloseTo(0.2, 10);
    expect(evaluateFormula('=1000*4%')).toBeCloseTo(40, 10);
  });

  it('reports an unbalanced paren rather than guessing', () => {
    const result = parseExpression('=SUM(A1:A3');
    expect(isFormulaError(result) && result.error).toBe('PARSE');
  });

  it('accepts a formula with or without the leading =', () => {
    expect(evaluateFormula('=1+1')).toBe(2);
    expect(evaluateFormula('1+1')).toBe(2);
  });
});

describe('references', () => {
  it('expands a range row-major', () => {
    expect(expandRange('A1', 'B2')).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('round-trips column letters past Z', () => {
    expect(columnLetters(0)).toBe('A');
    expect(columnLetters(26)).toBe('AA');
    expect(columnIndex('AA')).toBe(26);
  });

  it('collects every cell and name a formula depends on', () => {
    const ast = parseExpression('=SUM(A1:A3)+B1-[revenue]');
    if (isFormulaError(ast)) throw new Error(ast.message);
    const references = expressionReferences(ast);
    expect(references.cells).toEqual(['A1', 'A2', 'A3', 'B1']);
    expect(references.names).toEqual(['revenue']);
  });
});

describe('evaluation', () => {
  it('resolves cells and ranges', () => {
    expect(evaluateFormula('=A1+A2', context)).toBe(30);
    expect(evaluateFormula('=SUM(A1:A3)', context)).toBe(60);
    expect(evaluateFormula('=AVERAGE(A1:A3)', context)).toBe(20);
  });

  it('resolves a named operand as a whole column', () => {
    expect(evaluateFormula('=SUM(revenue)', context)).toBe(300);
  });

  it('treats blank as blank, not as zero', () => {
    const result = evaluateFormula('=D1+1', context);
    expect(isFormulaError(result) && result.error).toBe('VALUE');
    // But an aggregate skips it, which is the sheet rule.
    expect(evaluateFormula('=SUM(A1:D1)', context)).toBe(12);
  });

  it('reports division by zero rather than Infinity', () => {
    const result = evaluateFormula('=1/0');
    expect(isFormulaError(result) && result.error).toBe('DIV0');
  });

  it('names an unknown function instead of returning null', () => {
    const result = evaluateFormula('=NOPE(1)');
    expect(isFormulaError(result) && result.error).toBe('NAME');
  });

  it('runs IF without evaluating the branch it did not take', () => {
    expect(evaluateFormula('=IF(A1>5,"big","small")', context)).toBe('big');
    expect(evaluateFormula('=IF(A1>500,1/0,7)', context)).toBe(7);
  });

  it('catches an error with IFERROR', () => {
    expect(evaluateFormula('=IFERROR(1/0,"n/a")')).toBe('n/a');
  });

  it('compares text as text', () => {
    expect(evaluateFormula('="a"<"b"')).toBe(true);
  });

  it('concatenates with &', () => {
    expect(evaluateFormula('="Q"&1')).toBe('Q1');
  });
});

describe('finance functions', () => {
  it('discounts a cashflow series', () => {
    // 100 next year at 10% is 90.909…
    expect(evaluateFormula('=NPV(0.1,100)') as number).toBeCloseTo(90.909, 3);
  });

  it('finds the rate that zeroes a series', () => {
    // -100 now, +60 and +60: IRR ≈ 13.07%.
    expect(evaluateFormula('=IRR(-100,60,60)') as number).toBeCloseTo(0.1306, 3);
  });

  it('reports #NUM! when a series never crosses zero', () => {
    const result = evaluateFormula('=IRR(100,60,60)');
    expect(isFormulaError(result) && result.error).toBe('NUM');
  });

  it('computes a level payment', () => {
    // 10,000 over 12 periods at 1%/period.
    expect(evaluateFormula('=PMT(0.01,12,10000)') as number).toBeCloseTo(-888.49, 2);
  });

  it('handles a zero rate without dividing by zero', () => {
    expect(evaluateFormula('=PMT(0,10,1000)')).toBe(-100);
  });

  it('computes compound growth', () => {
    expect(evaluateFormula('=CAGR(100,200,3)') as number).toBeCloseTo(0.2599, 4);
  });

  it('compounds a future value', () => {
    expect(evaluateFormula('=FV(0.05,2,0,100)') as number).toBeCloseTo(-110.25, 2);
  });
});
