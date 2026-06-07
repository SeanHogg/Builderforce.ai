import { redirect } from 'next/navigation';

// Contributors was consolidated into Workforce as a tab. Keep this route alive
// as a redirect so old links and bookmarks land on the Contributors tab.
export default function ContributorsPage() {
  redirect('/workforce?tab=contributors');
}
