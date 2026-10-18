/**
 * The board-collector record kinds as registered IMPORTERS — one per
 * `IMPORT_DATASETS` entry, generated from that registry so a new dataset is a
 * registry row and nothing else.
 *
 * `boardImport.ts` stays the owner of the columns, coercion and the one
 * multi-row insert; this file only states how those plug into the import
 * contract (`application/import/importer.ts`):
 *
 *   preview → validate + coerce, insert nothing (the wizard's dry run) — 200
 *   commit  → the one insert; nothing written (every row refused) is `refused`,
 *             answered 400 with the per-row report, as it always was.
 */
import { TenantRole } from '../../domain/shared/types';
import type { Importer, ImportContext, ImportParse } from '../import/importer';
import { IMPORT_DATASETS, importBoardRows } from './boardImport';

export interface BoardImportInput {
  rows: Array<Record<string, unknown>>;
  /** Rows the caller already sent ahead of this batch, so `row N` errors
   *  number positions in the caller's file rather than in the batch. */
  rowOffset: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The body must guarantee its own SHAPE — an array of objects — so the per-row
 *  walk cannot meet a string. Which cells are valid is the registry's call. */
export function parseBoardImport(body: Record<string, unknown>): ImportParse<BoardImportInput> {
  const rows = body.rows ?? [];
  if (!Array.isArray(rows) || !rows.every(isRecord)) return { ok: false, error: 'rows must be an array of objects' };
  const rowOffset = body.rowOffset ?? 0;
  if (typeof rowOffset !== 'number' || !Number.isInteger(rowOffset) || rowOffset < 0) {
    return { ok: false, error: 'rowOffset must be a non-negative integer' };
  }
  return { ok: true, input: { rows, rowOffset } };
}

function boardImporter(kind: string): Importer<BoardImportInput> {
  const run = (ctx: ImportContext, input: BoardImportInput, dryRun: boolean) =>
    importBoardRows(ctx.db, ctx.env, ctx.tenantId, kind, input.rows, { dryRun, rowOffset: input.rowOffset });
  return {
    kind,
    label: kind,
    input: 'rows',
    minRole: TenantRole.MANAGER,
    parse: parseBoardImport,
    async preview(ctx, input) {
      return { status: 'previewed', body: await run(ctx, input, true) };
    },
    async commit(ctx, input) {
      const result = await run(ctx, input, false);
      return { status: result.inserted > 0 ? 'committed' : 'refused', body: result };
    },
  };
}

/** Every board record kind, in registry order. */
export const BOARD_IMPORTERS: readonly Importer<BoardImportInput>[] = Object.keys(IMPORT_DATASETS).map(boardImporter);
