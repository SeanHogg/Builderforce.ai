import { pageMetadata } from '@/lib/seo';
import ShortlistClient from './ShortlistClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Shortlist & invites',
  description: 'Shortlist freelancers, invite them to bid on a posting, and read the AI evaluation of the bids you receive.',
  path: '/talent/shortlist',
});

export default function TalentShortlistPage() {
  return <ShortlistClient />;
}
