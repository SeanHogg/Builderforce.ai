/**
 * Pulling a company's ACTUALS out of its books and into the rows the finance
 * rollup already reads — the writer that makes `finance.burn`, `finance.revenue`,
 * `finance.cash` and `finance.runway_months` live over something nobody typed.
 *
 * ── WHERE THE ROWS LAND, AND WHY THERE ────────────────────────────────────────
 * `financeRollup` reads three sources: `expenses` + `pay_runs` for burn,
 * `ledger_entries` for revenue and cash, and `invoice_line_items` for MRR. A synced
 * transaction goes into `ledger_entries`, and the choice was between that and a new
 * normalised table the rollup unions in. The kernel ledger won on three counts:
 *
 *   · It IS a normalised transaction — a signed amount, a denomination, an
 *     occurrence date, a counterparty and a memo — and PRD 20 §0 says needing a
 *     balance earns a denomination rather than a table. A `ledger_transactions`
 *     table would be the 60th of the 59 the consolidation absorbed.
 *   · `uq_ledger_entries_reference` on (tenant, denomination, reference) makes a
 *     re-sync idempotent on the provider's own stable id for free. The alternative
 *     was writing that unique index by hand on a new table.
 *   · Two of the four metrics already read it, so the burn/runway number changes
 *     SOURCE with the rollup keeping its shape.
 *
 * It did NOT win for `expenses`. An expense row is a CLAIM with a submitter, an
 * approver and a rejection path; a bank debit has none of those and writing one
 * there would put "who authorised this" beside money that has already gone.
 *
 * ── PROVENANCE, WHICH IS THE WHOLE POINT ──────────────────────────────────────
 * "A synced figure that cannot be distinguished from a typed one" is the failure
 * this exists to end, so the distinction is STRUCTURAL rather than a flag somebody
 * might forget: `account_kind = 'external'` is a value no other writer on the
 * platform produces, and every existing reader of `ledger_entries` filters on
 * 'tenant' | 'user' | 'partner' | 'seller' | 'agent'. A bank debit therefore cannot
 * reach a tenant's platform credit balance, and "which of these did a person type?"
 * is one predicate rather than an audit.
 *
 * ── THE DOUBLE-COUNT THIS AVOIDS ──────────────────────────────────────────────
 * A founder who has been typing expenses connects QuickBooks, which reports the
 * same money, and their burn doubles. So a month covered by a provider that sees
 * EVERYTHING leaving the company (`coversAllSpend`) supersedes the typed rows for
 * that month — the rule lives in the rollup, and this file's job is to stamp the
 * `ledgerCoverage` marker it reads. Stripe does not get that marker: suppressing
 * hand-typed rent on the strength of a revenue feed would make burn collapse
 * instead of double.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connections, ledgerAccounts, ledgerEntries } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  AccountingProviderError,
  accountingProvider,
  isAccountingProviderName,
  type AccountingProviderName,
  type LedgerBalance,
  type LedgerTransaction,
} from './accountingProviders';
import {
  LEDGER_CAPABILITY,
  listLedgerConnections,
  markLedgerError,
  markLedgerSynced,
  openLedgerCredential,
  readLedgerCursor,
  writeLedgerCursor,
} from './ledgerConnections';

/* ── the shape of a synced row ───────────────────────────────────────────────── */

/** The `ledger_entries.account_kind` no other writer on this platform produces. */
export const EXTERNAL_ACCOUNT_KIND = 'external';

/** Money in and money out, as entry kinds. The SIGN already says which, so these
 *  exist for the reader of an audit trail rather than for a query. */
export const EXTERNAL_CREDIT = 'external_credit';
export const EXTERNAL_DEBIT = 'external_debit';

/**
 * How far back a FIRST sync reaches: the same 18 months the rollup recomputes, so a
 * newly connected book fills the whole window the seat charts rather than starting
 * a runway series from today.
 */
export const LEDGER_BACKFILL_MONTHS = 18;

/**
 * How far back every LATER sync re-reads.
 *
 * Books restate. A transaction gets recategorised, a bill gets paid, an accountant
 * reclassifies a month at close — and re-reading only yesterday would freeze each
 * day at its first, most incomplete reading. Thirty-five days covers a full month
 * plus a close, which is the window an accountant actually works in.
 */
export const LEDGER_RESTATEMENT_DAYS = 35;

/**
 * Pages walked per connection per sweep.
 *
 * A Worker has a bounded subrequest allowance and the sweep runs every connected
 * workspace in one invocation. A very large backfill therefore finishes over
 * several nights rather than failing on the first — which for a cursor provider is
 * exactly right (the cursor is stored) and for a windowed one is harmless (the
 * window is re-read anyway).
 */
export const LEDGER_MAX_PAGES = 20;

/**
 * The denomination a transaction is stored under.
 *
 * `usd_cents` is the kernel's existing name for US dollars, and every other
 * currency follows the same shape. This is why a EUR-denominated book does NOT move
 * a USD burn figure: `financeRollup` filters `denomination = 'usd_cents'`, so a euro
 * row is stored faithfully and simply not summed into a dollar total. Inventing an
 * FX rate at write time would be the alternative, and a rate baked into a stored
 * row is wrong the next day and unfixable afterwards.
 */
export const denominationFor = (currency: string): string => `${currency.trim().toLowerCase() || 'usd'}_cents`;

/** `quickbooks:Purchase:184`. Unique per tenant per denomination, which is what
 *  makes a re-sync converge instead of accumulating. */
export const ledgerReference = (provider: AccountingProviderName, externalId: string): string =>
  `${provider}:${externalId}`.slice(0, 160);

/** Which account the money moved through, as the ledger's 64-character account ref. */
const accountRefFor = (connectionId: number, transaction: LedgerTransaction): string =>
  `${connectionId}:${transaction.accountId ?? 'book'}`.slice(0, 64);

/** What the rollup reads to decide whether a month's typed rows are superseded. */
export type LedgerCoverage = 'full' | 'revenue';

export interface LedgerSyncResult {
  connectionId: number;
  provider: AccountingProviderName;
  transactionsWritten: number;
  transactionsRemoved: number;
  accountsWritten: number;
  error?: string;
}

/* ── writing ─────────────────────────────────────────────────────────────────── */

/**
 * Upsert one page of normalised transactions.
 *
 * `onConflictDoUpdate` and not `doNothing`: a restated transaction — a
 * recategorised expense, a pending charge that has posted, a corrected amount — has
 * to overwrite the row it wrote last time. Doing nothing would leave the first,
 * most incomplete reading in place forever, which is precisely the failure the
 * restatement window exists to avoid.
 */
export async function writeLedgerTransactions(
  db: Db,
  tenantId: number,
  connectionId: number,
  provider: AccountingProviderName,
  coverage: LedgerCoverage,
  transactions: readonly LedgerTransaction[],
  now: Date,
): Promise<number> {
  let written = 0;
  for (const transaction of transactions) {
    if (!transaction.id || !Number.isFinite(transaction.amount)) continue;
    const cents = Math.round(transaction.amount * 100);
    const metadata = {
      provider,
      connectionId,
      // The provider's own status, kept because the rollup MUST exclude `pending`:
      // a hold on a card can still vanish and must never move a runway. The row is
      // still written — when it posts, the upsert corrects it in place.
      txStatus: transaction.status,
      // What the rollup reads to decide whether this month supersedes typed rows.
      ledgerCoverage: coverage,
      category: transaction.category,
      counterparty: transaction.counterparty,
      description: transaction.description,
      accountId: transaction.accountId,
      recurring: transaction.recurring,
      externalId: transaction.id,
    };
    await db
      .insert(ledgerEntries)
      .values({
        tenantId,
        accountKind: EXTERNAL_ACCOUNT_KIND,
        accountRef: accountRefFor(connectionId, transaction),
        denomination: denominationFor(transaction.currency),
        amount: String(cents),
        // Deliberately NULL. `balance_after` is a materialised running total for the
        // platform's own balances; a synced feed has never seen the opening balance,
        // so any number here would be a running total of an unknown starting point.
        // The real balance lives in `ledger_accounts`, which is state and not a sum.
        balanceAfter: null,
        entryKind: cents < 0 ? EXTERNAL_DEBIT : EXTERNAL_CREDIT,
        reference: ledgerReference(provider, transaction.id),
        memo: transaction.description.slice(0, 2_000),
        metadata,
        occurredAt: new Date(transaction.occurredAtISO),
      })
      .onConflictDoUpdate({
        target: [ledgerEntries.tenantId, ledgerEntries.denomination, ledgerEntries.reference],
        set: {
          amount: String(cents),
          entryKind: cents < 0 ? EXTERNAL_DEBIT : EXTERNAL_CREDIT,
          accountRef: accountRefFor(connectionId, transaction),
          memo: transaction.description.slice(0, 2_000),
          metadata,
          occurredAt: new Date(transaction.occurredAtISO),
        },
      });
    written += 1;
  }
  if (written) {
    // The sync stamp is what the finance surface renders, and it is the only thing
    // separating a live figure from a typed one on screen.
    await db
      .update(connections)
      .set({ lastSyncedAt: now, updatedAt: sql`NOW()` })
      .where(scopedToTenant(connections, tenantId, eq(connections.id, connectionId)));
  }
  return written;
}

/**
 * REPLAY REMOVALS. Not optional, and not a tidy-up.
 *
 * Plaid removes a transaction when the bank reverses or de-duplicates one. A row
 * that is added and never removed is a GHOST: an expense the bank says never
 * happened, permanently in the burn, permanently lowering the runway, and
 * indistinguishable from every other synced row. The delete is scoped to
 * `account_kind = 'external'` so a crafted or coincidental provider id can never
 * reach a platform credit row.
 */
export async function removeLedgerTransactions(
  db: Db,
  tenantId: number,
  provider: AccountingProviderName,
  externalIds: readonly string[],
): Promise<number> {
  const references = externalIds.filter(Boolean).map((id) => ledgerReference(provider, id));
  if (references.length === 0) return 0;
  const deleted = await db
    .delete(ledgerEntries)
    .where(scopedToTenant(ledgerEntries, tenantId, and(
      eq(ledgerEntries.accountKind, EXTERNAL_ACCOUNT_KIND),
      inArray(ledgerEntries.reference, references),
    )))
    .returning({ id: ledgerEntries.id });
  return deleted.length;
}

/** Upsert the balances a book reports. One row per account, corrected in place —
 *  a second row would be double-counted into the cash position. */
export async function writeLedgerBalances(
  db: Db,
  tenantId: number,
  connectionId: number,
  provider: AccountingProviderName,
  balances: readonly LedgerBalance[],
  now: Date,
): Promise<number> {
  let written = 0;
  for (const balance of balances) {
    if (!balance.accountId) continue;
    const values = {
      name: balance.accountName.slice(0, 300),
      accountKind: balance.accountKind,
      balance: String(Number.isFinite(balance.balance) ? balance.balance : 0),
      currency: balance.currency,
      asOfAt: new Date(balance.asOfISO),
      syncedAt: now,
    };
    await db
      .insert(ledgerAccounts)
      .values({
        tenantId,
        connectionId,
        provider,
        externalId: balance.accountId.slice(0, 200),
        ...values,
      })
      .onConflictDoUpdate({
        target: [ledgerAccounts.tenantId, ledgerAccounts.connectionId, ledgerAccounts.externalId],
        set: { ...values, updatedAt: sql`NOW()` },
      });
    written += 1;
  }
  return written;
}

/* ── one connection ──────────────────────────────────────────────────────────── */

/** The window this sweep asks a WINDOWED provider for. A book that has never synced
 *  gets the whole charted history; one that has gets the restatement window. */
export function ledgerWindow(now: Date, everSynced: boolean): { fromISO: string; toISO: string } {
  const from = new Date(now);
  if (everSynced) from.setUTCDate(from.getUTCDate() - LEDGER_RESTATEMENT_DAYS);
  else from.setUTCMonth(from.getUTCMonth() - LEDGER_BACKFILL_MONTHS);
  return { fromISO: from.toISOString(), toISO: now.toISOString() };
}

/**
 * Sync ONE connected book. Never throws — a failing connection is reported so the
 * other workspaces in the sweep still get their numbers.
 */
export async function syncLedgerConnection(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: number,
  now = new Date(),
): Promise<LedgerSyncResult> {
  const opened = await openLedgerCredential(db, env, tenantId, connectionId);
  if (!opened.ok) {
    return {
      connectionId,
      provider: 'quickbooks',
      transactionsWritten: 0,
      transactionsRemoved: 0,
      accountsWritten: 0,
      error: opened.error,
    };
  }
  const provider = accountingProvider(opened.provider);
  const coverage: LedgerCoverage = provider.coversAllSpend ? 'full' : 'revenue';
  const base: LedgerSyncResult = {
    connectionId,
    provider: opened.provider,
    transactionsWritten: 0,
    transactionsRemoved: 0,
    accountsWritten: 0,
  };

  let written = 0;
  let removed = 0;
  let seen = 0;
  let accountsWritten = 0;
  const storedCursor = await readLedgerCursor(db, tenantId, connectionId);
  let cursor: string | undefined = storedCursor ?? undefined;
  let checkpoint: string | null = storedCursor;

  try {
    const window = ledgerWindow(now, storedCursor != null);

    if (provider.fetchTransactions) {
      for (let page = 0; page < LEDGER_MAX_PAGES; page += 1) {
        const result = await provider.fetchTransactions(opened.credential, { ...window, cursor });
        seen += result.items.length;
        written += await writeLedgerTransactions(
          db, tenantId, connectionId, opened.provider, coverage, result.items, now,
        );
        // Removals are replayed in the SAME pass as the additions, before the
        // cursor advances. Deferring them to a second sweep would leave a window in
        // which the ledger holds money the bank has already retracted.
        if (result.removedIds?.length) {
          removed += await removeLedgerTransactions(db, tenantId, opened.provider, result.removedIds);
        }
        if (result.checkpoint) checkpoint = result.checkpoint;
        if (!result.cursor) break;
        cursor = result.cursor;
      }
    }

    if (provider.fetchBalances) {
      accountsWritten = await writeLedgerBalances(
        db, tenantId, connectionId, opened.provider, await provider.fetchBalances(opened.credential), now,
      );
    }

    await writeLedgerCursor(db, tenantId, connectionId, {
      cursor: checkpoint, seen, written, at: now,
    });
    await markLedgerSynced(db, tenantId, connectionId, now);
    await invalidateLedgerSummary(env, tenantId);
    return { ...base, transactionsWritten: written, transactionsRemoved: removed, accountsWritten };
  } catch (error) {
    const message = error instanceof AccountingProviderError
      ? error.message
      : error instanceof Error ? error.message : 'That book could not be synced.';
    reportCaughtError(error, {
      source: 'application/finance/ledgerSync.ts',
      operation: `syncLedgerConnection:${opened.provider}`,
    });
    // Whatever was written before the failure STAYS — it is real money that really
    // moved, and discarding a page because the next one 500'd would make a partial
    // outage look like a month with no spend. The cursor is not advanced, so the
    // next sweep re-reads from the last confirmed point.
    await writeLedgerCursor(db, tenantId, connectionId, {
      cursor: checkpoint, seen, written, error: message, at: now,
    });
    await markLedgerError(db, tenantId, connectionId, message);
    return {
      ...base,
      transactionsWritten: written,
      transactionsRemoved: removed,
      accountsWritten,
      error: message,
    };
  }
}

/** Sync every connected book in one workspace. Serial, for the same reason the ad
 *  sweep is: a Worker's subrequest allowance would be spent by the first fan-out. */
export async function syncTenantLedgers(
  db: Db, env: Env, tenantId: number, now = new Date(),
): Promise<LedgerSyncResult[]> {
  const connected = await listLedgerConnections(db, tenantId);
  const results: LedgerSyncResult[] = [];
  for (const connection of connected) {
    if (connection.status === 'revoked') continue;
    if (!isAccountingProviderName(connection.provider)) continue;
    results.push(await syncLedgerConnection(db, env, tenantId, connection.id, now));
  }
  return results;
}

/**
 * The scheduled sweep.
 *
 * DAILY, and the reasoning is the ad-insights sweep's verbatim: a book reports on a
 * daily grain and restates for weeks afterwards, so a five-minute cadence would
 * re-read the same unchanged month ~288 times a day against a Neon budget that has
 * to stay under $5/month, for numbers that cannot have moved. The KV work-gate
 * upstream (`cronWorkSignal`) means an idle platform never wakes the database at all.
 *
 * Tenants are discovered FROM THE CONNECTIONS rather than from a tenant list: a
 * workspace with no connected book is not work, and iterating every tenant to
 * discover that would be the expensive half of the sweep.
 */
export async function runLedgerSyncSweep(
  env: Env, db: Db, now = new Date(),
): Promise<{ tenants: number; connections: number; written: number; removed: number; failed: number }> {
  const rows = await db
    .selectDistinct({ tenantId: connections.tenantId })
    .from(connections)
    .where(and(
      eq(connections.capability, LEDGER_CAPABILITY),
      eq(connections.status, 'connected'),
    ));

  let connectionCount = 0;
  let written = 0;
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    const results = await syncTenantLedgers(db, env, row.tenantId, now);
    connectionCount += results.length;
    written += results.reduce((sum, result) => sum + result.transactionsWritten, 0);
    removed += results.reduce((sum, result) => sum + result.transactionsRemoved, 0);
    failed += results.filter((result) => result.error).length;
  }
  return { tenants: rows.length, connections: connectionCount, written, removed, failed };
}

/* ── the read the finance surface makes ──────────────────────────────────────── */

/** Cache key for {@link readLedgerSummary}. Per tenant, because the answer is. */
const summaryKey = (tenantId: number): string => `finance:ledger-summary:${tenantId}`;

/**
 * Sixty seconds. Short deliberately: this is the panel a founder refreshes right
 * after clicking "sync now", and a five-minute cache would show them the number
 * from before the sync and read as a broken button.
 */
const SUMMARY_TTL_SECONDS = 60;

export async function invalidateLedgerSummary(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, summaryKey(tenantId));
}

export interface LedgerSourceAccount {
  provider: AccountingProviderName;
  name: string;
  accountKind: string;
  balance: number;
  currency: string;
  asOfISO: string;
}

/**
 * Where this workspace's finance numbers COME FROM — the answer the surface needs
 * to be able to render "synced from Xero 14 minutes ago" instead of a bare figure.
 */
export interface LedgerSummary {
  /** True when at least one connected book has ever synced. */
  live: boolean;
  /** The newest sync across every connection, ISO. Null when nothing has synced. */
  lastSyncedAtISO: string | null;
  /** True when at least one connected provider sees everything that leaves — the
   *  difference between "your burn is live" and "your revenue is live". */
  spendCovered: boolean;
  connections: Array<{
    id: number;
    provider: AccountingProviderName;
    label: string;
    displayName: string;
    status: string;
    lastError: string | null;
    lastSyncedAtISO: string | null;
    coversAllSpend: boolean;
  }>;
  accounts: LedgerSourceAccount[];
  /** Cash held, netted across bank and credit accounts. Null when no book reports
   *  a balance — which is not zero, and rendering it as zero would put a runway of
   *  nought on the board of a company with money in the bank. */
  cashOnHand: number | null;
  /** How many synced money movements this workspace's numbers stand on. */
  syncedTransactionCount: number;
}

export async function readLedgerSummary(db: Db, env: Env, tenantId: number): Promise<LedgerSummary> {
  return getOrSetCached(env, summaryKey(tenantId), async () => {
    const connected = await listLedgerConnections(db, tenantId);

    const accountRows = await db
      .select({
        provider: ledgerAccounts.provider,
        name: ledgerAccounts.name,
        accountKind: ledgerAccounts.accountKind,
        balance: ledgerAccounts.balance,
        currency: ledgerAccounts.currency,
        asOfAt: ledgerAccounts.asOfAt,
      })
      .from(ledgerAccounts)
      .where(scopedToTenant(ledgerAccounts, tenantId));

    const [counted] = await db
      .select({ total: sql<string>`COUNT(*)` })
      .from(ledgerEntries)
      .where(scopedToTenant(ledgerEntries, tenantId, eq(ledgerEntries.accountKind, EXTERNAL_ACCOUNT_KIND)));

    const accounts: LedgerSourceAccount[] = accountRows.map((row) => ({
      provider: row.provider as AccountingProviderName,
      name: row.name,
      accountKind: row.accountKind,
      balance: Number(row.balance),
      currency: row.currency,
      asOfISO: row.asOfAt.toISOString(),
    }));

    // `other` accounts are excluded on purpose — the port declares three kinds and
    // says only two net into a cash position. A suspense or holding account summed
    // into cash is money the company cannot spend.
    const spendable = accounts.filter((account) => account.accountKind === 'bank' || account.accountKind === 'credit');
    const stamps = connected
      .map((connection) => connection.lastSyncedAtISO)
      .filter((value): value is string => !!value)
      .sort();

    return {
      live: stamps.length > 0,
      lastSyncedAtISO: stamps[stamps.length - 1] ?? null,
      spendCovered: connected.some((connection) => connection.coversAllSpend && connection.lastSyncedAtISO),
      connections: connected.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        displayName: connection.displayName,
        status: connection.status,
        lastError: connection.lastError,
        lastSyncedAtISO: connection.lastSyncedAtISO,
        coversAllSpend: connection.coversAllSpend,
      })),
      accounts,
      cashOnHand: spendable.length
        ? spendable.reduce((total, account) => total + account.balance, 0)
        : null,
      syncedTransactionCount: Number(counted?.total ?? 0),
    };
  }, { kvTtlSeconds: SUMMARY_TTL_SECONDS });
}
