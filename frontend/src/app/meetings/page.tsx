import { pageMetadata } from '@/lib/seo';
import MeetingsContent from '@/components/meetings/MeetingsContent';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Meetings',
  description:
    'Schedule and join live video and audio sessions with your team — standups, planning, retrospectives, ad-hoc and direct calls — and connect your Google or Microsoft calendar.',
  path: '/meetings',
});

export default function MeetingsPage() {
  return <MeetingsContent />;
}
