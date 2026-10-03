import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SignInDialogProvider } from '@/components/auth/signIn/SignInDialogProvider';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.meta');
  return pageMetadata({ title: t('title'), description: t('description'), path: '/studio' });
}

/** The Studio app (served at studio.builderforce.ai): one sign-in pop-up for every page in it. */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <SignInDialogProvider>{children}</SignInDialogProvider>;
}
