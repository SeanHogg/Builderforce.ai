/**
 * Importers — THE contract every "bring outside data in" path is built on:
 * parse → validate → preview → commit, with the importer registering the parts
 * that are genuinely its own.
 *
 *   parse    the request payload → this importer's input (or a refusal). Shape
 *            only: rows are an array of objects, a document is a non-empty string.
 *   preview  validate + report what WOULD land. Writes nothing. Always present —
 *            a dry run is how the /import wizard shows row errors before anything
 *            is written, and it is the whole of a draft importer.
 *   commit   write it. ABSENT for a draft importer (the OpenAPI → connector
 *            manifest): its output is a proposal a person reviews and saves
 *            through the normal create path, so there is nothing to commit here.
 *
 * {@link runImport} is the one sequence over those parts. The HTTP adapter
 * (`presentation/routes/importRoutes.ts → serveImport`) maps its outcome to a
 * status ONCE for every importer: refused → 400, previewed → 200, committed → 201.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Each import path had grown its own copy of that sequence, with its own idea of
 * which status a dry run answers and what a parse failure looks like. Registered
 * importers (`importers.ts`) make a new source one entry — and every one of them
 * is reachable at `POST /api/import/:kind`, the historical paths becoming
 * adapters over the same `runImport`.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { TenantRole } from '../../domain/shared/types';

/** What an importer may reach for. Narrow: an importer needing the request is a
 *  route, not an importer. */
export interface ImportContext {
  db: Db;
  env: Env;
  tenantId: number;
  segmentId: string | null;
  userId: string | null;
}

/** The single outcome every importer reports. */
export type ImportOutcome =
  /** Nothing could be (or will be) written — the body says why. */
  | { status: 'refused'; body: unknown }
  /** Validated; nothing written (a dry run, or a draft importer's proposal). */
  | { status: 'previewed'; body: unknown }
  /** Written. */
  | { status: 'committed'; body: unknown };

/** `parse`'s answer: the importer's input, or why the payload's shape is refused. */
export type ImportParse<I> = { ok: true; input: I } | { ok: false; error: string };

export interface Importer<I = unknown> {
  /** `POST /api/import/:kind`. */
  kind: string;
  label: string;
  /** `rows` → a tabular record kind (the /import wizard's); `document` → one
   *  uploaded document (YAML, an OpenAPI spec). */
  input: 'rows' | 'document';
  minRole: TenantRole;
  parse(body: Record<string, unknown>): ImportParse<I>;
  preview(ctx: ImportContext, input: I): Promise<ImportOutcome>;
  commit?(ctx: ImportContext, input: I): Promise<ImportOutcome>;
}

/**
 * Run one import: parse, then preview (a dry run, or an importer with no commit)
 * or commit. The ONE sequence — no importer re-implements it.
 */
export async function runImport<I>(
  importer: Importer<I>,
  ctx: ImportContext,
  body: Record<string, unknown>,
  opts: { dryRun: boolean },
): Promise<ImportOutcome> {
  const parsed = importer.parse(body);
  if (!parsed.ok) return { status: 'refused', body: { error: parsed.error } };
  if (opts.dryRun || !importer.commit) return importer.preview(ctx, parsed.input);
  return importer.commit(ctx, parsed.input);
}
