import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fetchPlatformProof, visibleProofMetrics, type PlatformProof } from '@/lib/platformProof';
import styles from './TrustSignals.module.css';

/**
 * Bandwagon social proof from LIVE platform counts (`GET /api/public/proof`).
 *
 * Renders nothing until the counts arrive, and nothing for a metric below its
 * display floor (`PROOF_FLOORS`) — so the bar can only ever show a real number,
 * and it simply disappears when the API is unreachable. Owns its own data and
 * visibility; drop it into any marketing surface as-is.
 */
export function SocialProofBar({ align = 'start' }: { align?: 'start' | 'center' }) {
  const t = useTranslations('marketingTrust.socialProof');
  const [proof, setProof] = useState<PlatformProof | null>(null);

  useEffect(() => {
    let live = true;
    // A failed read is not an error state: the bar's contract is to show only
    // real numbers, so with none to show it stays absent.
    fetchPlatformProof().then((p) => { if (live) setProof(p); }, () => { if (live) setProof(null); });
    return () => { live = false; };
  }, []);

  if (!proof) return null;
  const metrics = visibleProofMetrics(proof);
  if (metrics.length === 0) return null;

  return (
    <p className={`${styles.socialProof} ${align === 'center' ? styles.center : ''}`} aria-live="polite">
      {metrics.map((metric) => (
        <span key={metric} className={metric === 'buildersThisWeek' ? styles.socialProofHot : undefined}>
          {t(metric, { count: proof[metric] })}
        </span>
      ))}
    </p>
  );
}
