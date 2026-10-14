/**
 * The `sites` panel kind (PRD 33 §4.1, §4.2): the workspace's sites, and the
 * selected one's settings — label, allowed domains, privacy switches — its
 * install snippets and the live install checks. Opened from the app header's
 * "Sites" (`?panel=sites:<siteId>`).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplaySiteDto } from '@builderforce/interaction-contract';
import { Button, ButtonLink, SectionError, SectionLoading } from '@/components/ui';
import { RoleGate } from '@/components/RoleGate';
import { SiteSettingsForm, type SiteDraft } from '@/components/marketplace/capability/SiteSettingsForm';
import { SnippetTabs } from '@/components/marketplace/capability/SnippetTabs';
import { CapabilityVerify } from '@/components/marketplace/capability/CapabilityVerify';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { CAPABILITY_APPS } from '@/lib/marketplace/capabilityApps';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import type { InsightPanelKindProps } from '../panelKinds';
import styles from '@/components/marketplace/capability/capability.module.css';

function draftOf(site: ReplaySiteDto): SiteDraft {
  return { label: site.label, allowedOrigins: [...site.allowedOrigins], settings: { ...site.settings } };
}

export function SitesKind({ siteId, id }: InsightPanelKindProps) {
  const t = useTranslations('insights.sites');
  const errorMessage = useErrorMessage();
  const [sites, setSites] = useState<ReplaySiteDto[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState(id || siteId);
  // Edits and the save notice belong to the site they were made on, so switching
  // sites shows that site's own values without an effect resetting state.
  const [edit, setEdit] = useState<{ siteId: string; draft: SiteDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ siteId: string; ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    replaySitesApi.list()
      .then((list) => { if (live) setSites(list); })
      .catch((cause: unknown) => { if (live) setLoadError(cause); });
    return () => { live = false; };
  }, []);

  const selected = sites?.find((site) => site.id === selectedId) ?? sites?.[0] ?? null;
  const draft = selected ? (edit?.siteId === selected.id ? edit.draft : draftOf(selected)) : null;
  const notice = selected && saved?.siteId === selected.id ? saved : null;
  const setDraft = (next: SiteDraft) => { if (selected) setEdit({ siteId: selected.id, draft: next }); };

  if (loadError) return <SectionError error={loadError} />;
  if (!sites) return <SectionLoading label={t('loading')} />;
  if (!selected || !draft) {
    return (
      <div className={styles.stack}>
        <p className={styles.body}>{t('empty')}</p>
        <ButtonLink href={CAPABILITY_APPS.insights.setupPath} variant="primary">{t('add')}</ButtonLink>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setSaved(null);
    try {
      const updated = await replaySitesApi.update(selected.id, {
        label: draft.label.trim() || selected.label,
        ...(selected.kind === 'external' ? { allowedOrigins: draft.allowedOrigins } : {}),
        settings: draft.settings,
      });
      setSites((list) => (list ?? []).map((site) => (site.id === updated.id ? updated : site)));
      setEdit(null);
      setSaved({ siteId: updated.id, ok: true, text: t('saved') });
    } catch (cause) {
      setSaved({ siteId: selected.id, ok: false, text: errorMessage(cause) ?? t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.stack} data-testid="sites-kind">
      <ul className={styles.list} aria-label={t('listLabel')}>
        {sites.map((site) => (
          <li key={site.id} className={`${styles.listItem} ${site.id === selected.id ? styles.listItemActive : ''}`}>
            <button
              type="button"
              className={styles.linkButton}
              aria-pressed={site.id === selected.id}
              onClick={() => setSelectedId(site.id)}
            >
              {site.label}
            </button>
            <span className={styles.listMeta}>{t(`kind.${site.kind}` as never)}</span>
          </li>
        ))}
      </ul>
      <ButtonLink href={CAPABILITY_APPS.insights.setupPath} variant="ghost">{t('add')}</ButtonLink>

      <h3 className={styles.title}>{t('settings')}</h3>
      <SiteSettingsForm value={draft} onChange={setDraft} showDomains={selected.kind === 'external'} />
      <div className={styles.row}>
        <RoleGate capability="insights.manageSites">
          <Button variant="primary" onClick={() => void save()} disabled={saving} loading={saving} data-testid="sites-save">{t('save')}</Button>
        </RoleGate>
        {notice && <span role={notice.ok ? 'status' : 'alert'} className={notice.ok ? styles.listMeta : styles.error}>{notice.text}</span>}
      </div>

      <h3 className={styles.title}>{t('install')}</h3>
      <SnippetTabs key={selected.id} site={selected} />

      <h3 className={styles.title}>{t('verify')}</h3>
      <CapabilityVerify key={selected.id} siteId={selected.id} />
    </div>
  );
}
