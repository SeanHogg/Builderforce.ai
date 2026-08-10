'use client';

import { useTranslations } from 'next-intl';
import { ArticleCardGrid } from '@/components/blog/ArticleCard';
import {
  HomeButton,
  HomeSection,
  HomeSectionHeader,
  homePatternStyles as styles,
} from '@/components/home/HomePatterns';
import { BLOG_POSTS } from '@/lib/blogData';

export function LatestBlogSection() {
  const t = useTranslations();

  return (
    <HomeSection id="blog">
      <HomeSectionHeader
        centered
        eyebrow={t('home.beat.writing')}
        title={t('home.blogHeading')}
        lead={t('home.blogLead')}
      />
      <ArticleCardGrid posts={BLOG_POSTS} limit={3} />
      <div className={`${styles.actions} ${styles.actionsCenter}`}>
        <HomeButton href="/blog" arrow>{t('home.blogReadAll')}</HomeButton>
      </div>
    </HomeSection>
  );
}
