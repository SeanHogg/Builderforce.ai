/**
 * The paperwork half of FO-D5 — where two founders record what they agreed.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * The matching half landed on its own: `cofounder_profiles`, the scorer and this
 * page's sibling above. Two founders could find each other and had NOWHERE to
 * write down the result — no founders' agreement, no IP assignment, no founder
 * vesting. The signature engine already existed, so the whole gap was a template
 * plus a document routed through it.
 *
 * ── WHY THE FORM IS BUILT FROM THE TEMPLATE, NOT WRITTEN OUT ─────────────────
 * Each template declares its own variables (name, label, kind, required, hint) and
 * this renders them. A hand-written form per document would be four forms to keep
 * in step with four renderers, and the failure mode is the quiet one: a template
 * gains a clause that needs a value, and the form never asks for it.
 *
 * ── WHY PREVIEW COMES BEFORE SEND ────────────────────────────────────────────
 * A founders' agreement is the document people argue about BEFORE they sign it.
 * `render` writes nothing at all, so reading the draft costs nothing and changes
 * nothing; `send` is a separate, deliberate act that emails every named party a
 * link to sign. Collapsing the two into one button would make the most consequential
 * document a company produces a single click from a half-filled form.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  documentTemplates,
  renderDocumentTemplate,
  sendDocumentTemplate,
  type DocumentTemplateSummary,
  type RenderedDocument,
} from '@/lib/founderOpsApi';
import styles from './CofounderMatching.module.css';

/** One editable row of the `parties` table. Held as strings because it is a form —
 *  the number is parsed once, on the way out, rather than fought with on every
 *  keystroke. */
interface PartyDraft {
  name: string;
  email: string;
  role: string;
  share: string;
  contribution: string;
}

const EMPTY_PARTY: PartyDraft = { name: '', email: '', role: '', share: '', contribution: '' };

/** A founders' agreement with one founder is a note to self. Two is the honest
 *  starting shape, and rows are added from there. */
const INITIAL_PARTIES: PartyDraft[] = [{ ...EMPTY_PARTY }, { ...EMPTY_PARTY }];

export function FounderPaperwork() {
  const t = useTranslations('cofounder.paperwork');
  const [templates, setTemplates] = useState<DocumentTemplateSummary[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [parties, setParties] = useState<PartyDraft[]>(INITIAL_PARTIES);
  const [preview, setPreview] = useState<RenderedDocument | null>(null);
  const [sent, setSent] = useState<{ requestId: number; sent: number; failed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    documentTemplates()
      .then((list) => {
        if (cancelled) return;
        setTemplates(list);
        setTemplateKey((current) => current || list[0]?.key || '');
      })
      .catch(() => { if (!cancelled) setTemplates([]); });
    return () => { cancelled = true; };
  }, []);

  const template = useMemo(
    () => templates.find((candidate) => candidate.key === templateKey) ?? null,
    [templates, templateKey],
  );

  /** The payload BOTH actions send. One builder, so a preview can never be
   *  rendered from different values than the document that gets signed. */
  const payload = useCallback((): Record<string, unknown> => {
    const scalars = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value.trim() !== ''),
    );
    const rows = parties
      .filter((party) => party.name.trim())
      .map((party) => ({
        name: party.name.trim(),
        email: party.email.trim(),
        role: party.role.trim(),
        share: party.share.trim() === '' ? null : Number(party.share),
        contribution: party.contribution.trim(),
      }));
    return rows.length ? { ...scalars, parties: rows } : scalars;
  }, [parties, values]);

  const run = async (action: 'preview' | 'send') => {
    if (!template) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      if (action === 'preview') {
        setPreview(await renderDocumentTemplate(template.key, payload()));
      } else {
        const result = await sendDocumentTemplate(template.key, { values: payload() });
        setPreview(result.document);
        setSent({ requestId: result.requestId, sent: result.delivery.sent, failed: result.delivery.failed });
      }
    } catch (caught) {
      // The API refuses a missing required variable BY NAME. Surfaced verbatim,
      // because "founders, effectiveDate" is the actual next action and a generic
      // "please complete the form" is not.
      setError(caught instanceof Error ? caught.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  const setValue = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setSent(null);
  };
  const setParty = (index: number, patch: Partial<PartyDraft>) => {
    setParties((current) => current.map((party, i) => (i === index ? { ...party, ...patch } : party)));
    setSent(null);
  };

  const wantsParties = Boolean(template?.variables.some((variable) => variable.kind === 'parties'));

  return (
    <section aria-labelledby="paperwork-heading">
      <h2 id="paperwork-heading" className={styles.sectionTitle}>{t('title')}</h2>
      <p className={styles.notice}>{t('lede')}</p>

      <div className={styles.card}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="paperwork-template">{t('documentLabel')}</label>
          <select
            id="paperwork-template"
            className={styles.select}
            value={templateKey}
            onChange={(event) => { setTemplateKey(event.target.value); setPreview(null); setSent(null); setError(null); }}
          >
            {templates.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>{candidate.title}</option>
            ))}
          </select>
          {template && <p className={styles.help}>{template.purpose}</p>}
        </div>

        {template?.variables.filter((variable) => variable.kind !== 'parties').map((variable) => (
          <div className={styles.field} key={variable.name}>
            <label className={styles.label} htmlFor={`paperwork-${variable.name}`}>
              {variable.label}{variable.required ? '' : ` ${t('optional')}`}
            </label>
            {variable.kind === 'longText' ? (
              <textarea
                id={`paperwork-${variable.name}`}
                className={styles.textarea}
                value={values[variable.name] ?? ''}
                onChange={(event) => setValue(variable.name, event.target.value)}
              />
            ) : (
              <input
                id={`paperwork-${variable.name}`}
                className={styles.input}
                type={variable.kind === 'date' ? 'date' : variable.kind === 'number' ? 'number' : 'text'}
                value={values[variable.name] ?? ''}
                onChange={(event) => setValue(variable.name, event.target.value)}
              />
            )}
            <p className={styles.help}>{variable.hint}</p>
          </div>
        ))}

        {wantsParties && (
          <div className={styles.field}>
            <span className={styles.label}>{t('partiesLabel')}</span>
            <p className={styles.help}>{t('partiesHelp')}</p>
            {/* A table on a phone is a scroll trap, so each party is its own stacked
                block that reflows rather than a row that overflows. */}
            <ul className={styles.partyList}>
              {parties.map((party, index) => (
                <li className={styles.party} key={index}>
                  <div className={styles.partyGrid}>
                    <input
                      className={styles.input}
                      placeholder={t('partyName')}
                      aria-label={t('partyNameFor', { position: index + 1 })}
                      value={party.name}
                      onChange={(event) => setParty(index, { name: event.target.value })}
                    />
                    <input
                      className={styles.input}
                      type="email"
                      placeholder={t('partyEmail')}
                      aria-label={t('partyEmailFor', { position: index + 1 })}
                      value={party.email}
                      onChange={(event) => setParty(index, { email: event.target.value })}
                    />
                    <input
                      className={styles.input}
                      placeholder={t('partyRole')}
                      aria-label={t('partyRoleFor', { position: index + 1 })}
                      value={party.role}
                      onChange={(event) => setParty(index, { role: event.target.value })}
                    />
                    <input
                      className={styles.input}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder={t('partyShare')}
                      aria-label={t('partyShareFor', { position: index + 1 })}
                      value={party.share}
                      onChange={(event) => setParty(index, { share: event.target.value })}
                    />
                  </div>
                  <input
                    className={styles.input}
                    placeholder={t('partyContribution')}
                    aria-label={t('partyContributionFor', { position: index + 1 })}
                    value={party.contribution}
                    onChange={(event) => setParty(index, { contribution: event.target.value })}
                  />
                  {parties.length > 1 && (
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => setParties((current) => current.filter((_, i) => i !== index))}
                    >{t('removeParty')}</button>
                  )}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={() => setParties((current) => [...current, { ...EMPTY_PARTY }])}>
                {t('addParty')}
              </button>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} disabled={busy || !template} onClick={() => void run('preview')}>
            {busy ? t('working') : t('preview')}
          </button>
          <button type="button" className={styles.primary} disabled={busy || !template} onClick={() => void run('send')}>
            {busy ? t('working') : t('send')}
          </button>
        </div>
        <p className={styles.help}>{t('sendHelp')}</p>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {sent && (
          <p className={styles.notice} role="status">
            {t('sentNotice', { count: sent.sent })}
            {sent.failed > 0 ? ` ${t('sentFailed', { count: sent.failed })}` : ''}
          </p>
        )}
        {preview && (
          <>
            <h3 className={styles.summaryTitle}>{preview.title}</h3>
            {/* The document as it will be SENT — the same text the signature record
                freezes, not a rendering of it. Scrolls inside its own box so a long
                agreement never makes the page scroll sideways. */}
            <pre className={styles.document}>{preview.body}</pre>
          </>
        )}
      </div>
    </section>
  );
}
