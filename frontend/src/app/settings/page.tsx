import { Suspense } from 'react';
import { pageMetadata } from '@/lib/seo';
import SettingsClient from '@/components/settings/SettingsClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Settings',
  description: 'Manage your account, personality, sessions and workspace.',
  path: '/settings',
});

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsClient />
    </Suspense>
  );
}
