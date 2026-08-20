/**
 * The invoice as a FILE — the half of FO-C2 that was named and not built.
 *
 * ── WHY A PDF AND NOT "PRINT THIS PAGE" ─────────────────────────────────────
 * `pdfWriter.ts` already makes the argument and it applies here more sharply than
 * anywhere else: "the platform emitted PDF by opening the browser's print dialog
 * on a styled HTML page. That is not an export: it needs a human at a keyboard, it
 * cannot be attached to an email an agent sends, it cannot be stored as the
 * artifact of a run, and it prints whatever the visitor's browser thinks the page
 * looks like." An invoice is the document a customer forwards to their accounts
 * department and files for seven years. It cannot be a screenshot of somebody's
 * browser, and it cannot look different depending on who pressed print.
 *
 * No dependency is added — `renderPdf` writes the bytes from the same block model
 * the .docx and .pptx writers read, so an invoice, a proposal and a board pack are
 * one renderer.
 *
 * ── ONE DOCUMENT, THREE DOORS ───────────────────────────────────────────────
 * The figures come from `receivables.invoiceDocument`, which is also what the
 * customer's web page renders and what the founder's own copy reads. That is the
 * point of the shared projection: an invoice whose PDF and web page disagree about
 * the outstanding amount is worse than one with no PDF at all.
 *
 * ── WHY THE ISSUER'S NAME IS READ AND NOT PASSED ────────────────────────────
 * Because the caller that most needs it is the PUBLIC route, and a public caller
 * has no tenant to assert. The row reports its own tenant (the token resolved it),
 * and the tenant reports its own name and brand — so the name on the paper cannot
 * be supplied by whoever holds the link.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import type { MdBlock } from '../office/markdownBlocks';
import { renderPdf } from '../office/pdfWriter';
import { DEFAULT_TENANT_PALETTE, normalizePalette } from '../rfp/rfpBranding';
import { invoiceDocument, type PublicInvoiceDocument } from './receivables';

/** Who the invoice is FROM, as the paper must state it. */
export interface InvoiceIssuer {
  name: string;
  /** Hex, from `tenants.brand_palette`. The cover band and the table headers. */
  accent: string;
  secondary: string;
}

export interface RenderedInvoice {
  bytes: Uint8Array;
  /** What the browser saves it as. The invoice's own reference, so a customer's
   *  downloads folder sorts by the number they will quote back at us. */
  filename: string;
}

/**
 * Money on a document, formatted once.
 *
 * `en-US` and not the reader's locale, deliberately: this is the artifact, not the
 * screen. Two people opening the same invoice in two countries must see the same
 * characters, because they will quote them to each other — and a customer whose
 * copy says "1.234,56" while ours says "1,234.56" has, as far as they can tell, a
 * different invoice. The web page localises; the file does not.
 */
const money = (value: number, currency: string): string => {
  try {
    return value.toLocaleString('en-US', { style: 'currency', currency });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

/**
 * The blocks. Pure, and exported for its own test: this is what the customer
 * actually reads, and the assertions worth having are about what is on the page
 * (the outstanding amount, the due date, the lines) rather than about PDF bytes.
 *
 * The LINES are printed when there are any, and the agreed total is printed
 * regardless — the schema's own rule is that `amount` is what was AGREED and the
 * lines are checked against it, so a document that showed only the lines would be
 * a different assertion from the one the issuer made.
 */
export function invoiceBlocks(document: PublicInvoiceDocument, issuer: InvoiceIssuer): MdBlock[] {
  const blocks: MdBlock[] = [];

  blocks.push({
    kind: 'table',
    head: ['', ''],
    rows: [
      ['From', issuer.name],
      ['Billed to', document.customerName],
      ['Issued', day(document.issuedAtISO)],
      ['Due', day(document.dueAtISO)],
    ],
  });

  if (document.lines.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Items' });
    blocks.push({
      kind: 'table',
      head: ['Description', 'Qty', 'Unit price', 'Amount'],
      rows: document.lines.map((line) => [
        line.description,
        String(line.quantity),
        money(line.unitAmount, document.currency),
        money(line.amount, document.currency),
      ]),
    });
  }

  blocks.push({ kind: 'heading', level: 2, text: 'Total' });
  blocks.push({
    kind: 'table',
    head: ['', ''],
    rows: [
      ['Total', money(document.amount, document.currency)],
      // Printed only when some has landed. A line reading "Paid $0.00" on a fresh
      // invoice invites the reader to wonder what went wrong.
      ...(document.paidAmount > 0 ? [['Paid', money(document.paidAmount, document.currency)]] : []),
      ['Outstanding', money(document.outstanding, document.currency)],
    ],
  });

  if (document.outstanding <= 0) {
    blocks.push({ kind: 'paragraph', text: 'This invoice is settled. Thank you.' });
  } else if (document.paymentLinkUrl) {
    blocks.push({ kind: 'paragraph', text: `Pay online: ${document.paymentLinkUrl}` });
  }

  if (document.notes) {
    blocks.push({ kind: 'heading', level: 2, text: 'Notes' });
    blocks.push({ kind: 'paragraph', text: document.notes });
  }

  return blocks;
}

/** Who issued it, with a brand if the workspace set one. */
async function issuerFor(db: Db, tenantId: number): Promise<InvoiceIssuer> {
  const [row] = await db
    .select({ name: tenants.name, brandPalette: tenants.brandPalette })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const palette = normalizePalette(row?.brandPalette ?? null, DEFAULT_TENANT_PALETTE);
  return {
    // An invoice with no issuer name is not a document anybody can act on, so the
    // fallback names the platform rather than printing an empty band.
    name: row?.name?.trim() || 'Builderforce workspace',
    accent: palette.primary,
    secondary: palette.secondary,
  };
}

/**
 * Render one invoice to PDF bytes, or null when there is no such invoice.
 *
 * Null rather than a throw, because both callers already have a 404 to return and
 * an exception type here would be a third vocabulary for "not found" in a module
 * that has two.
 */
export async function renderInvoicePdf(db: Db, tenantId: number, reference: string): Promise<RenderedInvoice | null> {
  const document = await invoiceDocument(db, tenantId, reference);
  if (!document) return null;
  const issuer = await issuerFor(db, tenantId);

  const bytes = renderPdf({
    blocks: invoiceBlocks(document, issuer),
    title: `Invoice ${document.reference}`,
    subtitle: `From ${issuer.name} to ${document.customerName}`,
    // The headline figure is what is STILL OWED, not the total — the reader of a
    // part-paid invoice needs the number they have to act on, and putting the
    // gross there is how somebody pays twice.
    badge: { label: document.outstanding > 0 ? 'Amount due' : 'Settled', value: money(document.outstanding, document.currency) },
    footer: `Invoice ${document.reference} · ${issuer.name} · Due ${day(document.dueAtISO)}`,
    theme: { accent: issuer.accent, secondary: issuer.secondary },
  });

  // The reference can carry a slash or a space; a filename cannot carry the first
  // and should not carry the second.
  const safe = document.reference.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64) || 'invoice';
  return { bytes, filename: `invoice-${safe}.pdf` };
}
