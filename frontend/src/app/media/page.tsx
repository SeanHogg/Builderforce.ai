import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { MEDIA_KIT } from '@/lib/content';
import { pageMetadata } from '@/lib/seo';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('media.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/media',
    ogTitle: t('ogTitle'),
  });
}

/**
 * Media kit — downloadable marketing media (the sales deck as PDF / PowerPoint
 * plus every slide as PNG). Static assets live in `public/media/`; the file
 * list is the `MEDIA_KIT` single source in `lib/content.ts`.
 */
export default async function MediaPage() {
  const t = await getTranslations();

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(20px, 4vw, 48px) clamp(16px, 4vw, 32px) 80px' }}>
      {/* Hero */}
      <p style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 13, margin: '0 0 10px' }}>
        {t('media.eyebrow')}
      </p>
      <h1 style={{ color: 'var(--text-primary)', fontSize: 'clamp(28px, 4.5vw, 44px)', lineHeight: 1.15, margin: '0 0 14px' }}>
        {t('media.title')}
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'clamp(15px, 2vw, 18px)', lineHeight: 1.6, maxWidth: 760, margin: '0 0 32px' }}>
        {t('media.intro')}
      </p>

      {/* Deck preview */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 40px var(--shadow-coral-mid, rgba(59,130,246,0.2))', marginBottom: 36, maxWidth: 860 }}>
        <Image
          src={MEDIA_KIT.cover}
          alt={t('media.deckAlt')}
          width={MEDIA_KIT.coverWidth}
          height={MEDIA_KIT.coverHeight}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          priority
        />
      </div>

      {/* Download cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
        {MEDIA_KIT.assets.map((a) => (
          <div
            key={a.key}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 22px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <span style={{ alignSelf: 'flex-start', background: 'var(--accent-subtle)', color: 'var(--accent)', borderRadius: 999, padding: '3px 12px', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em' }}>
              {a.format}
            </span>
            <h2 style={{ color: 'var(--text-primary)', fontSize: 19, margin: '6px 0 0' }}>{t(`media.assets.${a.key}.name`)}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14.5, lineHeight: 1.55, margin: 0, flexGrow: 1 }}>
              {t(`media.assets.${a.key}.desc`)}
            </p>
            <a
              href={a.href}
              download
              style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '12px 16px', fontWeight: 600, fontSize: 15, textDecoration: 'none', minHeight: 44 }}
            >
              {t('media.download')} · {a.size}
            </a>
          </div>
        ))}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.6, marginTop: 28, maxWidth: 760 }}>
        {t('media.usageNote')}
      </p>
    </main>
  );
}
