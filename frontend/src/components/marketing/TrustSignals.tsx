import Link from 'next/link';
import { useTranslations } from 'next-intl';
import styles from './TrustSignals.module.css';

/**
 * The persuasion layer every marketing ask carries (with `SocialProofBar`).
 *
 * It pulls the classic mass-persuasion levers — loss framing, urgency,
 * belonging, bandwagon, authority, repetition — under ONE rule: no false claim.
 *
 *  - **Risk reversal + immediacy.** `TrustLine` says starting is free, instant
 *    and private. The urgency is real (it is live in seconds), never a fake
 *    countdown or "only N left" — scarcity we do not have is a lie.
 *  - **Authority you can inspect.** `ProofLinks` points at artifacts a visitor
 *    can open — the published method, the architecture write-up, named
 *    comparisons, a free diagnostic — never borrowed logos or invented quotes.
 *  - **The line, stated.** `HonestyPledge` names what we will not fake, so the
 *    rest of the site can be held to it.
 *
 * Every item is a claim the product already keeps (Free plan, guest-capable
 * local canvas, "Read and Prove cost nothing" from `lib/methodology.ts`). A new
 * item must be equally verifiable.
 */

/** Destinations are DATA; their labels live at `marketingTrust.proof.<id>`. */
const PROOF_LINKS = [
  { id: 'method', href: '/method' },
  { id: 'architecture', href: '/blog/inside-evermind-architecture' },
  { id: 'compare', href: '/compare' },
  { id: 'diagnostics', href: '/diagnostics' },
] as const;

export const HOW_WE_MARKET_HREF = '/about#how-we-market';

/** What starting costs you — the risk-reversal row under every primary ask. */
export function TrustLine({ align = 'start' }: { align?: 'start' | 'center' }) {
  const t = useTranslations('marketingTrust');
  const items = t.raw('items') as string[];
  return (
    <ul className={`${styles.trustLine} ${align === 'center' ? styles.center : ''}`} aria-label={t('itemsAria')}>
      {items.map((item) => (
        <li key={item}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
          {item}
        </li>
      ))}
    </ul>
  );
}

/** "Check our work" — authority a visitor verifies rather than takes on faith. */
export function ProofLinks({ align = 'start' }: { align?: 'start' | 'center' }) {
  const t = useTranslations('marketingTrust');
  return (
    <nav className={`${styles.proof} ${align === 'center' ? styles.center : ''}`} aria-label={t('proofLabel')}>
      <span className={styles.proofLabel}>{t('proofLabel')}</span>
      {PROOF_LINKS.map((link) => (
        <Link key={link.id} href={link.href}>{t(`proof.${link.id}`)}</Link>
      ))}
    </nav>
  );
}

/** One-line public commitment; links to the full statement on /about. */
export function HonestyPledge({ className = '' }: { className?: string }) {
  const t = useTranslations('marketingTrust');
  return (
    <p className={`${styles.pledge} ${className}`}>
      {t('pledge')}{' '}
      <Link href={HOW_WE_MARKET_HREF}>{t('pledgeLink')}</Link>
    </p>
  );
}
