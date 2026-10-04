import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SignInDialogProvider } from '@/components/auth/signIn/SignInDialogProvider';
import { SpawnShell } from '@/components/spawn/SpawnShell';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('spawn.meta');
  return pageMetadata({ title: t('title'), description: t('description'), path: '/spawn' });
}

/** Spawn (served at spawn.builderforce.ai): its own chrome and one sign-in pop-up for every page in it. */
export default function SpawnLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignInDialogProvider>
      <SpawnShell>{children}</SpawnShell>
    </SignInDialogProvider>
  );
}
