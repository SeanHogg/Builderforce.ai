import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  EMBED_CAPABILITIES,
  EMBED_VIEWS,
  EMBED_VIEW_KEYS,
  capabilityForView,
  type EmbedCapability,
  type EmbedView,
} from '@seanhogg/builderforce-embedded';

/**
 * The catalog of embeddable app surfaces, grouped by the capability area that
 * gates them. Derived entirely from the package's `EMBED_VIEWS` registry (the
 * single source of truth the host component and the frame route also validate
 * against), so it can never list a view a host cannot actually mount.
 *
 * This is the part of "BuilderForce surfaces" that is TRUE for everyone — a
 * signed-out visitor reading the marketing page, a viewer-role member, and the
 * owner about to enable it — which is why it takes no session or role input:
 * it is the answer to "what could my product show?", not a control.
 *
 * `enabledCapabilities` (optional) marks which areas this workspace has live so
 * a member can see at a glance what their own product may already mount.
 * View keys are rendered as code — they ARE the `view="…"` token a developer
 * types, so they are identifiers, not copy to translate.
 */

interface Props {
  enabledCapabilities?: readonly EmbedCapability[];
}

const chip: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-eyebrow)', padding: '2px 8px',
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
};

export function EmbedSurfaceCatalog({ enabledCapabilities = [] }: Props) {
  const t = useTranslations('embedded.surfaces');

  const groups = useMemo(() => EMBED_CAPABILITIES.map((capability) => ({
    capability,
    views: EMBED_VIEW_KEYS.filter((view) => capabilityForView(view) === capability),
  })), []);

  return (
    <section aria-label={t('catalogTitle')}>
      <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {t('catalogTitle')}
      </div>
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginBottom: 12 }}>
        {t('catalogIntro')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
        {groups.map(({ capability, views }) => {
          const live = enabledCapabilities.includes(capability);
          return (
            <article
              key={capability}
              style={{
                padding: 14, borderRadius: 'var(--radius-md)',
                border: `1px solid ${live ? 'var(--accent)' : 'var(--border-subtle)'}`,
                background: 'var(--bg-elevated)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>{t(`capability.${capability}`)}</strong>
                {live && (
                  <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--accent)' }}>{t('live')}</span>
                )}
              </div>
              <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginBottom: 10 }}>
                {t('viewCount', { count: views.length })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {views.map((view: EmbedView) => (
                  <span key={view} title={EMBED_VIEWS[view].label} style={chip}>{view}</span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
