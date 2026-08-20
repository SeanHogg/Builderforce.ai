/**
 * The STATEMENT — the one shape both creator surfaces are built from.
 *
 * ── WHY A STATEMENT AND NOT A SETTING ────────────────────────────────────────
 * Operator decision 3 is that there is NO choice of host and NO choice of
 * database: an app runs on Builderforce and its data lives here. A settings row
 * with a control in it would be a lie about that — it would imply a decision the
 * reader does not get to make and the platform would not honour. So the unit of
 * this UI is a sentence with the facts in it, not a field with a picker beside
 * it.
 *
 * Extracted rather than written twice: the convert panel says these things
 * BEFORE conversion ("this will run at…") and the project panel says them after
 * ("this runs at…"), and two copies is how the two surfaces start describing the
 * same platform differently.
 */

import styles from './appPanels.module.css';
import { useFormat } from "@/i18n/useFormat";

export type StatementTone = 'ok' | 'pending' | 'muted';

const PILL_CLASS: Record<StatementTone, string> = {
  ok: styles.pillOk,
  pending: styles.pillPending,
  muted: styles.pillMuted,
};

export interface AppStatementProps {
  /** The section this belongs to — Address, Runtime, Data, People. */
  title: string;
  /** The sentence. The reader is here for this line. */
  statement: string;
  /** The supporting fact, when there is one worth a second line. */
  detail?: string;
  /** A short status word, tinted by tone. Omitted when there is nothing to say. */
  badge?: { label: string; tone: StatementTone };
  children?: React.ReactNode;
}

export function AppStatement({ title, statement, detail, badge, children }: AppStatementProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {badge && <span className={`${styles.pill} ${PILL_CLASS[badge.tone]}`}>{badge.label}</span>}
      </div>
      <p className={styles.statement}>{statement}</p>
      {detail && <p className={styles.statementDetail}>{detail}</p>}
      {children}
    </section>
  );
}

/**
 * A row of counts under a statement.
 *
 * `auto-fit` rather than a fixed column count, so three tiles become one column
 * at 360px without anybody writing a media query for it.
 */
export function AppCounts({ items }: { items: Array<{ label: string; value: number }> }) {
  const fmt = useFormat();
  return (
    <div className={styles.counts}>
      {items.map((item) => (
        <div key={item.label} className={styles.count}>
          <div className={styles.countValue}>{fmt.number(item.value)}</div>
          <div className={styles.countLabel}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * An address.
 *
 * The DISPLAY form is derived here rather than at each call site: an address is
 * shown as its host (`sunday-rsvp.builderforce.app`), never as a raw URL with a
 * scheme and a trailing slash, and three surfaces stripping that themselves is
 * how one of them starts showing `https://`.
 *
 * `url` is null while the site read is in flight or when the address is reserved
 * and nothing is served yet; `fallback` is the label the session read already
 * knows, so the reader sees the name instead of an empty box.
 */
export function AppAddress({ url, fallback }: { url: string | null; fallback?: string | null }) {
  const shown = url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : fallback;
  if (!shown) return null;
  if (!url) return <span className={styles.address}>{shown}</span>;
  return (
    <a className={styles.address} href={url} target="_blank" rel="noreferrer">
      {shown}
    </a>
  );
}
