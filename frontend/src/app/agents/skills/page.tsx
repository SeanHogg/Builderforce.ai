import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import SkillsBrowser from './SkillsBrowser';
import { fetchSkills } from './skillsData';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agents.skills');
  return pageMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/agents/skills' });
}

export default async function SkillsPage() {
  const skills = await fetchSkills();
  return <SkillsBrowser skills={skills} />;
}
