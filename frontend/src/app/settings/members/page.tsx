import { redirect } from 'next/navigation';

// Members was consolidated into the unified Workforce directory (people + agents
// in one grid). Keep this route alive as a redirect so old links and bookmarks
// still land somewhere useful.
export default function MembersPage() {
  redirect('/workforce');
}
