import { describe, expect, it } from 'vitest';
import { boardInventory, findInInventory, scopeNote } from './canvasContextSnapshot';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

function node(id: string, kind: CreationObjectKind, title: string, extra: Record<string, unknown> = {}) {
  return { id, data: { kind, title, ...extra } };
}

/**
 * These assertions are written against the REPORTED failure: a board holding a
 * chat, a code object imported from `Builderforce-Sales-Discovery-Guide.htm`,
 * a slides template and a workflow, with only the chat in scope.
 */
const BOARD = [
  node('c67dc008', 'chat', 'Brain'),
  node('n2', 'code', 'Builderforce-Sales-Discovery-Guide.htm', { fileName: 'Builderforce-Sales-Discovery-Guide.htm' }),
  node('n3', 'slides', '6 Slides Template [FOR BOARD MEETINGS 2025].pptx'),
  node('n4', 'workflow', 'Renewal Outreach Workflow'),
];

describe('boardInventory', () => {
  it('lists every object even when the turn is scoped to one', () => {
    const inventory = boardInventory(BOARD, new Set(['c67dc008']));
    expect(inventory).toHaveLength(4);
    expect(inventory.filter((entry) => entry.inScope).map((entry) => entry.id)).toEqual(['c67dc008']);
    // The file the model claimed did not exist is present, out of scope, and
    // still named — which is the whole point: a name is what makes it findable.
    const file = inventory.find((entry) => entry.id === 'n2')!;
    expect(file.inScope).toBe(false);
    expect(file.title).toBe('Builderforce-Sales-Discovery-Guide.htm');
  });

  it('omits a fileName that merely repeats the title', () => {
    const [entry] = boardInventory([node('n1', 'code', 'a.ts', { fileName: 'a.ts' })], new Set());
    expect(entry.fileName).toBeUndefined();
  });

  it('falls back to the path when there is no file name', () => {
    const [entry] = boardInventory([node('n1', 'code', 'Handler', { path: 'src/handler.ts' })], new Set());
    expect(entry.fileName).toBe('src/handler.ts');
  });
});

describe('scopeNote', () => {
  it('forbids an absence claim when the view is partial', () => {
    const note = scopeNote('selection', 4, 1);
    expect(note).toContain('PARTIAL VIEW');
    expect(note).toContain('CANNOT conclude that something is missing');
    expect(note).toContain('Never tell the user to upload something the inventory already shows');
  });

  it('says so plainly when the view IS the whole board', () => {
    expect(scopeNote('canvas', 4, 4)).toContain('COMPLETE board');
  });
});

describe('findInInventory', () => {
  const inventory = boardInventory(BOARD, new Set(['c67dc008']));

  it('finds the file the user actually named', () => {
    expect(findInInventory(inventory, 'Builderforce-Sales-Discovery-Guide.htm')?.id).toBe('n2');
  });

  it('survives the .htm/.html slip that triggered the report', () => {
    expect(findInInventory(inventory, 'Builderforce-Sales-Discovery-Guide.html')?.id).toBe('n2');
  });

  it('matches a partial name', () => {
    expect(findInInventory(inventory, 'sales-discovery')?.id).toBe('n2');
  });

  it('returns null rather than guessing', () => {
    expect(findInInventory(inventory, 'quarterly-budget.xlsx')).toBeNull();
    expect(findInInventory(inventory, '   ')).toBeNull();
  });
});
