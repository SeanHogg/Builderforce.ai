import dynamic from 'next/dynamic';
import type { TemplatesFigure } from './types';

/**
 * The template gallery pulls `RESUME_TEMPLATES`, and through it the whole canvas
 * contract. The overwhelming majority of posts embed no template, so it is
 * deferred rather than statically imported — a component-level split, not a
 * library one.
 */
const BlogResumeTemplates = dynamic(() => import('../BlogResumeTemplates'), { ssr: false });

export default function Templates({ spec }: { spec: TemplatesFigure }) {
  return <BlogResumeTemplates templateIds={spec.templateIds} />;
}
