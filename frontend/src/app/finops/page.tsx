import { redirect } from 'next/navigation';

export const runtime = 'edge';

// DevFinOps is consolidated into the Finance hub at /insights/finance as an
// interactive drill-down. Preserve old deep links by redirecting into the
// DevFinOps (R&D / SOC / audit) slide-out panel.
export default function FinopsPage() {
  redirect('/insights/finance?drill=devfinops');
}
