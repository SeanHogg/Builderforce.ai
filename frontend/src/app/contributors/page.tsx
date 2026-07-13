import { redirect } from 'next/navigation';

// Contributors activity was merged into the Workforce → Performance tab. Keep
// this route alive as a redirect so old links and bookmarks still resolve.
export default function ContributorsPage() {
  redirect('/workforce?tab=performance');
}
