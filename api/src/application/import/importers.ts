/**
 * THE registry of importers — every path that brings outside data in through
 * parse → validate → preview → commit (`importer.ts`).
 *
 * Open/closed: a new source is an importer declared in its own domain module and
 * one entry here; `POST /api/import/:kind` and every historical path serve it
 * through the same `runImport`.
 *
 * `GET /api/import/kinds` stays the projection of the ROW kinds only (the
 * /import wizard renders a column form and a label per kind); document importers
 * are reached by their own builders.
 *
 * NOT importers, deliberately (distinct semantics, not a parse/preview/commit of
 * an uploaded payload):
 *   - `/api/migrations`        an async, multi-entity PULL from a connected board
 *                              provider (a job with progress and a cutover policy);
 *   - `/api/specs/import`      fetches ONE ticket from a board connection by id;
 *   - `/api/personas/psychometric/import`  a pure sanitiser that persists nothing.
 */
import type { Importer } from './importer';
import { BOARD_IMPORTERS } from '../insights/boardImporters';
import { workflowDefinitionImporter } from '../workflow/definitionImporter';
import { openApiConnectorImporter } from '../connectors/openapiConnectorImporter';

// `Importer`'s parse/preview/commit are METHODS, so an importer of a specific
// input type is assignable to `Importer<unknown>` — the registry holds them all,
// and `runImport` only ever hands an importer the input its own `parse` produced.
const IMPORTERS: readonly Importer<unknown>[] = [
  ...BOARD_IMPORTERS,
  workflowDefinitionImporter,
  openApiConnectorImporter,
];

const BY_KIND = new Map(IMPORTERS.map((i) => [i.kind, i]));

export function getImporter(kind: string): Importer<unknown> | undefined {
  return BY_KIND.get(kind);
}

export function listImporters(): readonly Importer<unknown>[] {
  return IMPORTERS;
}
