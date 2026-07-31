import { redirect } from 'next/navigation';

// "Find work" (open jobs, my proposals, my engagements) was merged into /marketplace
// as its "Gigs" category — this standalone route now just forwards there, covering old
// bookmarks and in-app links that haven't been repointed. In-app nav links point
// straight at /marketplace?category=gigs.
export const runtime = 'edge';

export default function FreelancerGigsPage() {
  redirect('/marketplace?category=gigs');
}
