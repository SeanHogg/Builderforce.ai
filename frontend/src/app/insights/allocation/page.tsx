import { redirect } from 'next/navigation';

// Investment Allocation is consolidated into the Finance hub at /insights/finance
// as an interactive drill-down. Preserve old deep links by redirecting straight
// into the allocation slide-out panel.
export default function AllocationInsightsRedirect() {
  redirect('/insights/finance?drill=allocation');
}
