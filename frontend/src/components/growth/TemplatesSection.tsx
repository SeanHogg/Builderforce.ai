'use client';

/**
 * Reusable subject and body. "Use" hands the pick to the Campaigns tab via
 * `?template=` rather than holding composer state here — the compose flow needs
 * an audience, a sender and a transport, which belong to that tab's bounded
 * context, not this one's.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { growthApi, type EmailTemplate } from '@/lib/growthApi';
import { button, listItem, listReset, muted, spread, Row } from './growthStyles';

export function TemplatesSection() {
  const t = useTranslations('growth');
  const confirm = useConfirm();
  const router = useRouter();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { templates: tpl } = await growthApi.listTemplates();
    setTemplates(tpl);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (op: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await op();
      setNotice(successMessage);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }, [reload, t]);

  return (
    <section>
      {notice && <p role="status" style={{ ...muted, color: 'var(--success-text)' }}>{notice}</p>}
      {error && <p role="alert" style={{ ...muted, color: 'var(--danger-text)' }}>{error}</p>}
      {templates.length === 0 ? (
        <p style={{ ...muted, marginTop: 10 }}>{t('templates.empty')}</p>
      ) : (
        <ul style={listReset}>
          {templates.map((template) => (
            <li key={template.id} style={listItem}>
              <div style={spread}>
                <strong style={{ fontSize: 14 }}>{template.name}</strong>
                <span style={muted}>{t(`templates.source.${
                  ['builtin', 'imported', 'generated'].includes(template.source) ? template.source : 'custom'
                }`)}</span>
              </div>
              {template.mergeFields.length > 0 && (
                <div style={{ ...muted, marginTop: 2 }}>
                  {t('templates.mergeFields', { fields: template.mergeFields.join(', ') })}
                </div>
              )}
              <Row>
                <button type="button" style={button} disabled={busy}
                  onClick={() => router.push(`/growth?tab=campaigns&template=${template.id}`)}>
                  {t('templates.use')}
                </button>
                <button type="button" style={button} disabled={busy}
                  onClick={async () => {
                    const ok = await confirm({ message: t('templates.confirmDelete', { name: template.name }) });
                    if (!ok) return;
                    await run(() => growthApi.deleteTemplate(template.id), t('templates.deleted'));
                  }}>
                  {t('templates.delete')}
                </button>
              </Row>
            </li>
          ))}
        </ul>
      )}
      <Row>
        <ImportTemplateButton busy={busy} onImport={(name, bodyHtml) => run(
          () => growthApi.createTemplate({ name, bodyHtml, source: 'imported' }),
          t('templates.imported'),
        )} label={t('templates.import')} />
      </Row>
    </section>
  );
}

/**
 * Import an .html file as a template.
 *
 * A file picker rather than a paste box: a real template is hundreds of lines of
 * table markup that someone exported from a design tool, and pasting it into a
 * textarea is where it gets truncated. The name comes from the filename, which
 * is what the author already called it.
 */
function ImportTemplateButton({
  busy, onImport, label,
}: { busy: boolean; onImport: (name: string, bodyHtml: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept=".html,.htm,text/html" style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          onImport(file.name.replace(/\.html?$/i, ''), await file.text());
        }} />
      <button type="button" style={button} disabled={busy} onClick={() => ref.current?.click()}>{label}</button>
    </>
  );
}
