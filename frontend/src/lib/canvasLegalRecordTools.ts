/**
 * The canvas's LEGAL-RECORD vocabulary — put the real `legal_entities`,
 * `intellectual_property` and `legal_matters` rows on the board as cards.
 *
 * ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
 * `legalObjects.ts` declares three kinds whose every field is a projection of a
 * row. Without this tool they would be three cards a model fills in from what
 * somebody said in chat — which is precisely the "two answers to when does our
 * mark lapse" the kinds' own header refuses. A card is only a projection if
 * something projects it.
 *
 * ── WHY NO API WORK ─────────────────────────────────────────────────────────
 * All three tables are registered through the generic entity layer
 * (`api/src/application/domains/legal/entities.ts`), and `legal` is a `Domain`,
 * so `getEntityRows('legal', …)` already reads them tenant-scoped. The same
 * shape `canvas_sync_account` uses to reach `party_roles` — one client-side
 * projection, no route, no second reader to keep in step with the schema.
 *
 * ── WHY ONE TOOL AND NOT THREE ──────────────────────────────────────────────
 * "Put our legal position on the board" is one instruction, and the three
 * records answer it together: an IP asset names the entity that holds it and a
 * matter names the entity it is against, so syncing one without the others
 * produces cards that reference names nothing on the board carries. `record`
 * narrows it when the user genuinely asked for one — "show me our trademarks" —
 * and the default is all three.
 *
 * ── WHY IT IS NOT GATED ─────────────────────────────────────────────────────
 * Reading rows this tenant already owns and drawing them on this tenant's own
 * board sends nothing anywhere. `canvasApprovalGate.GATED_ACTIONS` is for acts
 * that reach OUTSIDE the tenant — which is why `legalDocument.share` is listed
 * there and `legalDocument.sync` is not, and `sync` is the only act these three
 * kinds declare.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import { getEntityRows } from '@/lib/kernel/kernelApi';

/** Cap on how many records one sync will author per kind. A board is a working
 *  surface; a hundred trademarks is an export, and the entity browser is where
 *  that belongs. Matches `canvas_sync_account`'s reasoning and its number. */
const MAX_RECORDS = 25;

/** How many rows to READ before filtering. Higher than the authoring cap because
 *  a name filter has to be applied to the whole set to be honest about "no
 *  match" rather than "no match in the first twenty-five". */
const READ_LIMIT = 200;

/** Which canvas kind each record projects onto. The `record` argument's values are
 *  the words a person says ("our entities", "our IP", "the matters"), not the table
 *  names, and this is the one place the two are joined. */
const RECORD_KINDS = {
  entity: 'legalEntity',
  ip: 'ipAsset',
  matter: 'legalMatter',
} as const;

export type LegalRecordSelector = keyof typeof RECORD_KINDS;

const SELECTORS = Object.keys(RECORD_KINDS) as readonly LegalRecordSelector[];

type Row = Record<string, unknown>;

/** A trimmed string from a row, whatever scalar the column actually returned.
 *  Numeric and boolean columns are stringified rather than dropped: `is_parent`
 *  and every `numeric` amount arrive as one or the other depending on the driver,
 *  and a card that silently omits an exposure figure is worse than one that shows
 *  it as text. */
export function rowText(value: unknown, max = 400): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** A date column as an ISO day. Postgres `date` arrives as `YYYY-MM-DD` already;
 *  a timestamp is truncated rather than rendered with a time nobody recorded. */
const rowDate = (value: unknown): string => rowText(value).slice(0, 10);

/** Only the keys that actually resolved. A projection that writes empty strings
 *  over a card's existing values would make a partial row look like a correction. */
function filled(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => {
    if (value === undefined || value === null || value === '') return false;
    return !(Array.isArray(value) && value.length === 0);
  }));
}

/** The registration rows belonging to one entity, as the card's `registrations`
 *  table. Ordered by renewal date so the thing about to lapse is the first row a
 *  reader's eye lands on — the ordering IS the point of the column. */
export function registrationRowsFor(entityId: string, registrations: readonly Row[]): Record<string, unknown>[] {
  return registrations
    .filter((row) => rowText(row.entityId) === entityId)
    .map((row) => ({
      jurisdiction: rowText(row.jurisdiction, 96),
      kind: rowText(row.kind, 32),
      reference: rowText(row.reference, 96),
      renewsAt: rowDate(row.renewsAt),
      status: rowText(row.status, 16),
    }))
    .sort((a, b) => String(a.renewsAt || '9999').localeCompare(String(b.renewsAt || '9999')));
}

/** One `legal_entities` row → the `legalEntity` card's fields.
 *
 *  `taxId` is read by the generic reader and deliberately NOT projected — see the
 *  kind's own comment in `legalObjects.ts`: an EIN on a card that gets shared,
 *  exported and pasted into a data room is a disclosure none of this kind's
 *  questions need. */
export function legalEntityFieldsFrom(row: Row, registrations: readonly Row[], parents: ReadonlyMap<string, string>): Record<string, unknown> {
  const recordId = rowText(row.id, 32);
  const legalName = rowText(row.legalName, 255);
  const status = rowText(row.status, 24);
  const parentId = rowText(row.parentId, 32);
  return filled({
    title: legalName || `Entity ${recordId}`,
    status: status || 'active',
    recordId,
    legalName,
    entityType: rowText(row.entityType, 32),
    jurisdiction: rowText(row.jurisdiction, 96),
    registrationNumber: rowText(row.registrationNumber, 96),
    formedAt: rowDate(row.formedAt),
    registeredAgent: rowText(row.registeredAgent, 255),
    registeredAddress: rowText(row.registeredAddress),
    renewsAt: rowDate(row.renewsAt),
    entityStatus: status,
    parentEntity: parentId ? (parents.get(parentId) ?? '') : '',
    registrations: registrationRowsFor(recordId, registrations),
    notes: rowText(row.notes),
  });
}

/** One `intellectual_property` row → the `ipAsset` card's fields. */
export function ipAssetFieldsFrom(row: Row, entities: ReadonlyMap<string, string>): Record<string, unknown> {
  const recordId = rowText(row.id, 32);
  const title = rowText(row.title, 255);
  const status = rowText(row.status, 16);
  const entityId = rowText(row.entityId, 32);
  return filled({
    title: title || `IP asset ${recordId}`,
    status: status || 'idea',
    recordId,
    ipKind: rowText(row.kind, 24),
    jurisdiction: rowText(row.jurisdiction, 96),
    classification: rowText(row.classification, 96),
    registrationNumber: rowText(row.registrationNumber, 96),
    filedAt: rowDate(row.filedAt),
    grantedAt: rowDate(row.grantedAt),
    renewsAt: rowDate(row.renewsAt),
    ipStatus: status,
    assignedFrom: rowText(row.assignedFrom, 200),
    assignedAt: rowDate(row.assignedAt),
    owner: rowText(row.ownerRef, 64),
    entityName: entityId ? (entities.get(entityId) ?? '') : '',
    notes: rowText(row.notes),
  });
}

/** One `legal_matters` row → the `legalMatter` card's fields.
 *
 *  `counterpartyName` and not `counterpartyRef`: the card's `counterparty` field
 *  resolves against the board's `account` objects through
 *  `counterpartyAccountField`, which matches on an account's TITLE and aliases —
 *  so handing it the display name is what makes the link resolve, and the slug
 *  would resolve to nothing while looking like a value. */
export function legalMatterFieldsFrom(row: Row, entities: ReadonlyMap<string, string>): Record<string, unknown> {
  const recordId = rowText(row.id, 32);
  const title = rowText(row.title, 255);
  const status = rowText(row.status, 24);
  const entityId = rowText(row.entityId, 32);
  const timeline = Array.isArray(row.timeline) ? row.timeline : [];
  return filled({
    title: title || `Matter ${recordId}`,
    status: status || 'open',
    recordId,
    matterKind: rowText(row.kind, 24),
    counterparty: rowText(row.counterpartyName, 200),
    counsel: rowText(row.counsel, 200),
    owner: rowText(row.ownerRef, 64),
    matterStatus: status,
    exposure: rowText(row.exposure, 16),
    currency: rowText(row.currency, 8),
    exposureAmount: rowText(row.exposureAmount, 32),
    spendToDate: rowText(row.spendToDate, 32),
    openedAt: rowDate(row.openedAt),
    nextActionAt: rowDate(row.nextActionAt),
    closedAt: rowDate(row.closedAt),
    timeline: timeline.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const milestone = entry as Row;
      return [{ at: rowDate(milestone.at), event: rowText(milestone.event, 200), note: rowText(milestone.note) }];
    }),
    entityName: entityId ? (entities.get(entityId) ?? '') : '',
    notes: rowText(row.notes),
  });
}

const NO_TENANT = 'This needs a signed-in, saved canvas session: it reads real legal records, and an anonymous board has no workspace behind it. Say so in one sentence and never claim it ran.';

/** True when this row's name matches what the user asked for. Substring and
 *  case-insensitive, because a person says "the Acme dispute" for a matter titled
 *  "Acme Industries v. us (breach of MSA)". */
function matchesName(fields: Record<string, unknown>, needle: string): boolean {
  if (!needle) return true;
  return String(fields.title ?? '').toLowerCase().includes(needle.toLowerCase());
}

export function canvasLegalRecordActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  /**
   * Write one projected record onto the board, creating the card when absent.
   *
   * Matched on `recordId` and NOT on title, for the reason `canvas_sync_account`
   * matches on `partyRef`: the id is the identity, and a matter whose title
   * counsel rewrote after a filing would otherwise land on the board twice.
   */
  const place = (
    kind: string,
    fields: Record<string, unknown>,
    existing: ReadonlyArray<{ id: string; data: Record<string, unknown> }>,
    at: { x?: number; y?: number },
  ): { objectId: string; title: string; recordId: string; updated: boolean } => {
    const recordId = String(fields.recordId ?? '');
    const match = existing.find((object) => String(object.data.recordId ?? '') === recordId && recordId !== '');
    if (match) {
      ctx.updateObject(match.id, fields, `Refreshed ${String(fields.title)}`);
      return { objectId: match.id, title: String(fields.title), recordId, updated: true };
    }
    const { objectId } = ctx.addObject(kind, fields, at);
    return { objectId, title: String(fields.title), recordId, updated: false };
  };

  return [
    {
      name: 'canvas_sync_legal',
      description:
        'Put the workspace\'s REAL legal records on the canvas — the legal entities it has incorporated, the intellectual property it owns or has applied for, and the matters counsel is arguing. Call this whenever the user asks about the company\'s legal position ("when does our trademark renew", "what are we incorporated as", "what is open with counsel", "what lapses this quarter"), and BEFORE authoring any answer about a renewal, a filing or an exposure — these cards ARE the rows, and anything typed onto them by hand is a second answer the legal seat does not hold. Creates each card when absent and refreshes it when present, matching on the record id rather than the title. If the workspace holds no record of the requested kind, the result says so — say that plainly and never invent one.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          record: {
            type: 'string',
            enum: [...SELECTORS],
            description: 'Sync only one kind of record: `entity` for legal entities, `ip` for intellectual property, `matter` for legal matters. Omit to sync all three, which is the right default because each references the others by name.',
          },
          name: { type: 'string', description: 'Sync only records whose title contains this. Use it when the user named ONE entity, mark or dispute.' },
          limit: { type: 'number', minimum: 1, maximum: MAX_RECORDS, description: `Maximum cards to author per record kind. Defaults to ${MAX_RECORDS}.` },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { record?: string; name?: string; limit?: number; x?: number; y?: number };
        const wanted: readonly LegalRecordSelector[] = SELECTORS.includes(args.record as LegalRecordSelector)
          ? [args.record as LegalRecordSelector]
          : SELECTORS;
        const limit = Math.max(1, Math.min(Math.round(args.limit ?? MAX_RECORDS), MAX_RECORDS));
        const needle = typeof args.name === 'string' ? args.name.trim() : '';
        const at = { ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}) };

        // Entities are read WHENEVER anything is synced, even when the caller asked
        // only for IP or matters: both of those name the entity that holds them, and
        // resolving that name needs the entity table. They are only AUTHORED as cards
        // when the caller actually asked for them.
        const [entityPage, registrationPage] = await Promise.all([
          getEntityRows('legal', 'legal_entities', { limit: READ_LIMIT }),
          wanted.includes('entity')
            ? getEntityRows('legal', 'legal_registrations', { limit: READ_LIMIT })
            : Promise.resolve({ rows: [] as Row[], total: 0 }),
        ]);
        const entityRows = entityPage.rows as Row[];
        const entityNames = new Map<string, string>(
          entityRows.map((row) => [rowText(row.id, 32), rowText(row.legalName, 255)]),
        );

        const projected: Record<LegalRecordSelector, Record<string, unknown>[]> = { entity: [], ip: [], matter: [] };

        if (wanted.includes('entity')) {
          projected.entity = entityRows
            .map((row) => legalEntityFieldsFrom(row, registrationPage.rows as Row[], entityNames))
            .filter((fields) => matchesName(fields, needle));
        }
        if (wanted.includes('ip')) {
          const page = await getEntityRows('legal', 'intellectual_property', { limit: READ_LIMIT });
          projected.ip = (page.rows as Row[])
            .map((row) => ipAssetFieldsFrom(row, entityNames))
            .filter((fields) => matchesName(fields, needle));
        }
        if (wanted.includes('matter')) {
          const page = await getEntityRows('legal', 'legal_matters', { limit: READ_LIMIT });
          projected.matter = (page.rows as Row[])
            .map((row) => legalMatterFieldsFrom(row, entityNames))
            .filter((fields) => matchesName(fields, needle));
        }

        const found = wanted.reduce((total, selector) => total + projected[selector].length, 0);
        if (!found) {
          return {
            recordsFound: false,
            reason: needle ? 'no-match' : 'no-records',
            instruction: needle
              ? `No legal record in this workspace matches "${needle}". Ask the user to confirm the name, or say plainly that the legal seat holds nothing under it. Never author a legalEntity, ipAsset or legalMatter card from what was said in conversation — every field on those kinds is a projection of a row, and a typed one is a record the company does not have.`
              : 'This workspace holds no legal records yet. Say so plainly and point the user at the legal seat to create the entity, IP asset or matter — do NOT author these cards by hand, because every field on them projects a row that would not exist.',
          };
        }

        const synced: Record<string, unknown> = {};
        let truncated = 0;
        for (const selector of wanted) {
          const kind = RECORD_KINDS[selector];
          const all = projected[selector];
          if (all.length > limit) truncated += all.length - limit;
          const existing = ctx.objects().filter((object) => object.kind === kind);
          synced[kind] = all.slice(0, limit).map((fields) => place(kind, fields, existing, at));
        }

        return {
          ok: true, proposed: true, recordsFound: true,
          synced,
          ...(truncated ? { moreAvailable: truncated } : {}),
          instruction: 'These cards are the records themselves. Bind a `trigger` to `renewsAt` on an entity or an IP asset, or to `nextActionAt` on a matter, to have the board warn before a filing lapses rather than after. To CHANGE any of these values, change the row through the legal seat and call this tool again — never edit the card.',
        };
      },
    },
  ];
}
