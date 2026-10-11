/**
 * The first few published people for the storefront's search — the All view's
 * Talent strip. The Talent grid itself pages and filters on the server; this is
 * the same read with neither.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { listFreelancers, type FreelancerProfile } from '@/lib/freelance/talentProfile';
import { SkeletonGrid } from './SkeletonGrid';
import { TalentCard, TALENT_GRID_STYLE } from './TalentCard';

export function TalentPreview({ search, limit }: { search: string; limit: number }) {
  const tt = useTranslations('talent');
  const [rows, setRows] = useState<FreelancerProfile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Debounced like the Talent grid, so the shared search box does not fire a
    // request per keystroke.
    const handle = setTimeout(() => {
      listFreelancers({ q: search || undefined, pageSize: limit })
        .then((res) => { if (!cancelled) setRows(res.items); })
        .catch(() => { if (!cancelled) setRows([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [search, limit]);

  if (rows === null) return <SkeletonGrid count={limit} />;
  if (rows.length === 0) return <p className="mp-builtin__empty">{tt('empty')}</p>;
  return (
    <div style={TALENT_GRID_STYLE}>
      {rows.map((f) => <TalentCard key={f.userId} profile={f} />)}
    </div>
  );
}
