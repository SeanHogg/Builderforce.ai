import type { Metadata } from 'next';
import SkillsBrowser from './SkillsBrowser';
import { fetchSkills } from './skillsData';

export const metadata: Metadata = {
  title: 'Agent Skills Directory — BuilderForce Agents',
  description:
    'Browse the BuilderForce Agents agent skills directory. Discover pre-built skills for code review, testing, documentation, security scanning, and more.',
  alternates: { canonical: '/agents/skills' },
};

export default async function SkillsPage() {
  const skills = await fetchSkills();
  return <SkillsBrowser skills={skills} />;
}
