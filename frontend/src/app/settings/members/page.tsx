import { redirect } from 'next/navigation';

// Members was consolidated into Workforce as a tab. Keep this route alive as a
// redirect so old links and bookmarks land on the Members tab.
export default function MembersPage() {
  redirect('/workforce?tab=members');
}
