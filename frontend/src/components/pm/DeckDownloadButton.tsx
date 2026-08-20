'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { decksApi, type DeckTemplateSummary } from '@/lib/builderforceApi';
import { Select } from '@/components/Select';

/**
 * Board-deck download — the dedicated entry point (paired with the Brain
 * `generate_deck` tool). Picks a template (the built-in R&D board deck or
 * CFO/DevFinOps deck, plus any custom uploads) + a quarter, then generates and
 * downloads the .pptx populated from workspace data. Fully localized.
 */

/** Current + previous three quarters as 'YYYY-Qn' options. */
function quarterOptions(): string[] {
  const now = new Date();
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    out.push(`${y}-Q${q}`);
    q -= 1;
    if (q < 1) { q = 4; y -= 1; }
  }
  return out;
}

export function DeckDownloadButton() {
  const t = useTranslations('decks');
  const [templates, setTemplates] = useState<DeckTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [quarter, setQuarter] = useState<string>(quarterOptions()[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the generation had to fall back on — a binding with no data behind it,
   * or a chart in an uploaded template whose series count does not match the
   * numbers bound to it. The API computed and stored these from the beginning
   * and the button dropped them on the floor, so a deck quietly built on
   * placeholders looked exactly like one built on real figures.
   */
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    decksApi.listTemplates()
      .then((rows) => { if (!alive) return; setTemplates(rows); if (rows[0]) setTemplateId(rows[0].id); })
      .catch(() => { /* button still works with the default template */ });
    return () => { alive = false; };
  }, []);

  const onDownload = async () => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const tmpl = templates.find((x) => x.id === templateId);
      setWarnings(await decksApi.download({ templateId: templateId || undefined, quarter, mode: tmpl?.fillable ? 'fill' : 'generative' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const selectStyle: React.CSSProperties = {
    padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
    background: 'var(--surface)', fontSize: '0.82rem', color: 'inherit',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Select aria-label={t('pickTemplate')} value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={selectStyle}>
        {templates.length === 0 && <option value="">{t('boardDeck')}</option>}
        {templates.map((tmpl) => (
          <option key={tmpl.id} value={tmpl.id}>{tmpl.isBuiltin ? t(tmpl.archetype === 'cfo_devfinops' ? 'cfoDeck' : 'boardDeck') : tmpl.name}</option>
        ))}
      </Select>
      <Select aria-label={t('pickQuarter')} value={quarter} onChange={(e) => setQuarter(e.target.value)} style={selectStyle}>
        {quarterOptions().map((q) => <option key={q} value={q}>{q}</option>)}
      </Select>
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        style={{
          padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: busy ? 'default' : 'pointer',
          background: 'var(--indigo-bright)', color: 'var(--text-on-accent)', fontSize: '0.82rem', fontWeight: 600, opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? t('generating') : t('download')}
      </button>
      {error && <span style={{ fontSize: '0.75rem', color: 'var(--error-text)' }}>{error}</span>}
      {warnings.length > 0 && (
        <details style={{ flexBasis: '100%', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--warning-text)' }}>
            {t('warnings', { count: warnings.length })}
          </summary>
          <ul style={{ margin: '6px 0 0', paddingInlineStart: '1.1rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
