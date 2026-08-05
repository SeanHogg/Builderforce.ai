import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
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

      {/* Sales enablement library */}
      <section style={{ marginTop: 52 }}>
        <p style={{ color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 12, margin: '0 0 8px' }}>Sales enablement</p>
        <h2 style={{ color: 'var(--text-primary)', fontSize: 'clamp(22px, 3vw, 30px)', margin: '0 0 8px' }}>Turn interest into a useful conversation.</h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 700, margin: '0 0 22px' }}>Practical, approved materials for prospecting, discovery, follow-up, and lead management.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
          {[
            { name: 'Sales discovery guide', desc: 'Qualification questions, impact prompts, and a clean next-step framework.', href: '/media/sales/Builderforce-Sales-Discovery-Guide.html', format: 'GUIDE' },
            { name: 'Outbound email playbook', desc: 'A concise three-touch sequence with approved Builderforce positioning.', href: '/media/sales/Builderforce-Outbound-Playbook.html', format: 'PLAYBOOK' },
            { name: 'CRM contact template', desc: 'Import-ready CSV columns for contacts, markets, and pipeline stages.', href: '/media/sales/Builderforce-Contacts-Template.csv', format: 'CSV' },
          ].map((asset) => (
            <a key={asset.href} href={asset.href} download style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 18, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-elevated)', color: 'var(--text-primary)', textDecoration: 'none' }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, flexShrink: 0, borderRadius: 10, background: 'var(--accent-subtle)', color: 'var(--accent)', fontSize: 11, fontWeight: 800 }}>{asset.format}</span>
              <span><strong style={{ display: 'block', fontSize: 15, marginBottom: 4 }}>{asset.name}</strong><small style={{ display: 'block', color: 'var(--text-muted)', lineHeight: 1.45 }}>{asset.desc}</small></span>
            </a>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 52, padding: 'clamp(24px, 4vw, 42px)', borderRadius: 18, border: '1px solid var(--border-accent)', background: 'linear-gradient(135deg, var(--accent-subtle), var(--bg-elevated) 68%)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 670 }}>
          <p style={{ color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 12, margin: '0 0 8px' }}>Referral & sales associate program</p>
          <h2 style={{ color: 'var(--text-primary)', fontSize: 'clamp(22px, 3vw, 31px)', margin: '0 0 8px' }}>Want to grow Builderforce with us?</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>Create a free associate account and get a focused sales hub with contact lists, pipeline management, market targeting, email campaigns, weekly goals, calendar sync, and direct access to Builderforce leadership.</p>
        </div>
        <Link href="/register?role=sales&next=/sales" style={{ display: 'inline-flex', minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: '0 21px', borderRadius: 10, background: 'var(--accent)', color: '#fff', textDecoration: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}>Become a sales associate →</Link>
      </section>

      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.6, marginTop: 28, maxWidth: 760 }}>
        {t('media.usageNote')}
      </p>
    </main>
  );
}
