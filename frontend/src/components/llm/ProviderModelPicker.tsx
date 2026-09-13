'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ToastProvider';
import { faultMessage } from '@/lib/apiClient';
import type { LlmProvider, ProviderAuthType } from '@/lib/builderforceApi';
import type { ProviderModelChoice } from '@/lib/providerModelsApi';
import { useProviderModels } from '@/lib/useProviderModels';
import { ReorderableList } from './ReorderableList';
import { buttonPrimary, inputStyle, sectionTitle } from './providerKeysStyles';

/** Rows rendered at once. A provider catalog runs to hundreds of ids; the search narrows it. */
const MAX_VISIBLE_ROWS = 150;

type TFn = ReturnType<typeof useTranslations>;

const mutedText: CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 };
const eyebrowText: CSSProperties = { fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: 0 };

/**
 * Choose WHICH of a connected provider's models routing uses, and in what order — from the
 * provider's full published catalog (Qwen Cloud's model marketplace), each marked with
 * whether the tenant's own key can call it.
 *
 * Self-contained: it reads and saves through its own client, and renders nothing for an
 * account that is not connected or a provider that publishes no model catalog — so it can
 * sit in every provider drawer without the drawer deciding which providers have one.
 */
export function ProviderModelPicker({
  provider,
  providerLabel,
  authType,
}: {
  provider: LlmProvider;
  /** Brand name used in the copy ("Qwen") — literal, not translated. */
  providerLabel: string;
  /** How the account is connected; `null` = not connected. Changing it reloads the list. */
  authType: ProviderAuthType | null;
}) {
  const t = useTranslations('providerKeys.models');
  const toast = useToast();
  const { view, draft, setDraft, error, saving, save, dirty } = useProviderModels(provider, authType);
  const [query, setQuery] = useState('');
  const [onlyOnAccount, setOnlyOnAccount] = useState(false);

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (view?.models ?? []).filter((choice) =>
      (!needle || choice.id.toLowerCase().includes(needle))
      && (!onlyOnAccount || choice.onAccount === true));
  }, [view, query, onlyOnAccount]);

  if (authType === null) return null;
  if (!view) {
    return error
      ? <p role="alert" style={{ ...mutedText, color: 'var(--coral-bright)', marginTop: 16 }}>{t('loadError')}</p>
      : null;
  }
  if (!view.supported) return null;

  const atMax = draft.length >= view.maxSelected;
  const toggle = (id: string) => setDraft(
    draft.includes(id) ? draft.filter((m) => m !== id) : atMax ? draft : [...draft, id],
  );
  const onSave = async () => {
    try {
      await save();
      toast.success(t('saved'));
    } catch (e) {
      toast.error(faultMessage(e, t('saveError')) ?? t('saveError'));
    }
  };
  const visible = matching.slice(0, MAX_VISIBLE_ROWS);
  const headingId = `provider-models-${provider}`;

  return (
    <section
      aria-labelledby={headingId}
      style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div id={headingId} style={sectionTitle}>{t('title')}</div>
      <p style={mutedText}>{t('hint', { provider: providerLabel })}</p>
      <p style={eyebrowText}>
        {view.accountChecked ? t('sourceNote', { provider: providerLabel }) : t('accountUnchecked')}
      </p>

      <div style={{ ...mutedText, fontWeight: 700, color: 'var(--text-primary)' }}>{t('orderTitle')}</div>
      {draft.length === 0 ? (
        <p style={mutedText}>{t('none')}</p>
      ) : (
        <ReorderableList
          keys={draft}
          labels={{}}
          onReorder={setDraft}
          onRemove={(id) => setDraft(draft.filter((m) => m !== id))}
        />
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          aria-label={t('searchLabel')}
          style={{ ...inputStyle, flex: '1 1 200px', fontFamily: 'inherit' }}
        />
        {view.accountChecked && (
          <label style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: 6, minHeight: 36, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyOnAccount} onChange={(e) => setOnlyOnAccount(e.target.checked)} />
            {t('onlyOnAccount')}
          </label>
        )}
      </div>
      <p style={eyebrowText} role="status">
        {t('selectedCount', { count: draft.length, max: view.maxSelected })}
        {atMax ? ` · ${t('atMax', { max: view.maxSelected })}` : ''}
      </p>

      <div
        role="group"
        aria-label={t('listLabel')}
        style={{
          maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)',
        }}
      >
        {visible.length === 0 ? (
          <p style={{ ...mutedText, padding: 12 }}>{t('empty')}</p>
        ) : visible.map((choice) => (
          <ModelRow
            key={choice.id}
            choice={choice}
            checked={draft.includes(choice.id)}
            disabled={atMax && !draft.includes(choice.id)}
            onToggle={() => toggle(choice.id)}
            t={t}
          />
        ))}
      </div>
      {matching.length > visible.length && (
        <p style={eyebrowText}>{t('showing', { shown: visible.length, total: matching.length })}</p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          style={{ ...buttonPrimary, opacity: !dirty || saving ? 0.5 : 1 }}
        >
          {saving ? t('saving') : t('save')}
        </button>
        {draft.length > 0 && (
          <button type="button" onClick={() => setDraft([])} disabled={saving} style={buttonPrimary}>
            {t('clear')}
          </button>
        )}
      </div>
    </section>
  );
}

function ModelRow({
  choice,
  checked,
  disabled,
  onToggle,
  t,
}: {
  choice: ProviderModelChoice;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  t: TFn;
}) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', minHeight: 40, flexWrap: 'wrap',
        borderBottom: '1px solid var(--border-subtle)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
        {choice.id}
      </span>
      {choice.onAccount === true && (
        <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, color: 'var(--success-text)' }}>{t('onAccount')}</span>
      )}
      {choice.onAccount === false && (
        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('notOnAccount')}</span>
      )}
    </label>
  );
}
