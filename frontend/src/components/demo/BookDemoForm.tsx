'use client';

/**
 * Shared "book a demo with sales" form (migration 0360). One source of truth for
 * the lead-capture fields + submit, reused by the public /book-demo page and the
 * demo convert / exit-intent panels — the form owns its own state and success
 * message so no consumer re-implements it.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { submitSalesLead, DEMO_PERSONAS } from '@/lib/demoApi';

export interface BookDemoFormProps {
  /** Where this lead was captured (e.g. 'book-demo-page' | 'demo-exit' | 'demo-convert'). */
  source: string;
  /** Pre-select a persona/topic (e.g. the demo the visitor was in). */
  defaultInterest?: string;
  /** Called after a successful submit. */
  onSuccess?: () => void;
  /** Compact layout for use inside a slide-out panel. */
  compact?: boolean;
}

type Status = 'idle' | 'sending' | 'ok' | 'error';

export function BookDemoForm({ source, defaultInterest, onSuccess, compact }: BookDemoFormProps) {
  const t = useTranslations('bookDemo');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [interest, setInterest] = useState(defaultInterest ?? '');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    try {
      await submitSalesLead({ name: name.trim(), email: email.trim(), company: company.trim(), interest, message: message.trim(), source });
      setStatus('ok');
      onSuccess?.();
    } catch {
      setStatus('error');
    }
  };

  if (status === 'ok') {
    return (
      <div className="bdf-success" role="status">
        <div className="bdf-success-icon" aria-hidden>✓</div>
        <p className="bdf-success-title">{t('successTitle')}</p>
        <p className="bdf-success-body">{t('successBody')}</p>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <form className={`bdf${compact ? ' bdf-compact' : ''}`} onSubmit={onSubmit}>
      <div className="bdf-row">
        <label className="bdf-field">
          <span className="bdf-label">{t('nameLabel')}</span>
          <input className="bdf-input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder={t('namePlaceholder')} />
        </label>
        <label className="bdf-field">
          <span className="bdf-label">{t('emailLabel')}</span>
          <input className="bdf-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder={t('emailPlaceholder')} />
        </label>
      </div>
      <div className="bdf-row">
        <label className="bdf-field">
          <span className="bdf-label">{t('companyLabel')}</span>
          <input className="bdf-input" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" placeholder={t('companyPlaceholder')} />
        </label>
        <label className="bdf-field">
          <span className="bdf-label">{t('interestLabel')}</span>
          <select className="bdf-input bdf-select" value={interest} onChange={(e) => setInterest(e.target.value)}>
            <option value="">{t('interestAny')}</option>
            {DEMO_PERSONAS.map((p) => (
              <option key={p} value={p}>{t(`personas.${p}`)}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="bdf-field">
        <span className="bdf-label">{t('messageLabel')}</span>
        <textarea className="bdf-input bdf-textarea" value={message} onChange={(e) => setMessage(e.target.value)} rows={compact ? 2 : 3} placeholder={t('messagePlaceholder')} />
      </label>
      {status === 'error' && <p className="bdf-error" role="alert">{t('error')}</p>}
      <button className="bdf-submit" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? t('submitting') : t('submit')}
      </button>
      <style>{styles}</style>
    </form>
  );
}

const styles = `
  .bdf { display: flex; flex-direction: column; gap: 14px; }
  .bdf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 520px) { .bdf-row { grid-template-columns: 1fr; } }
  .bdf-field { display: flex; flex-direction: column; gap: 6px; }
  .bdf-label { font-size: 13px; font-weight: 600; color: var(--text-primary, #f0f4ff); }
  .bdf-input {
    width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px;
    border: 1px solid var(--border, rgba(255,255,255,0.14));
    background: var(--surface-2, rgba(255,255,255,0.04));
    color: var(--text-primary, #f0f4ff); font-size: 14px; font-family: inherit;
  }
  .bdf-input:focus { outline: 2px solid var(--accent, #4d9eff); outline-offset: 1px; border-color: transparent; }
  .bdf-select { color: var(--text-primary, #f0f4ff); }
  .bdf-select option { background: var(--surface, #12151c); color: var(--text-primary, #f0f4ff); }
  .bdf-textarea { resize: vertical; }
  .bdf-error { margin: 0; color: #ff6b6b; font-size: 13px; }
  .bdf-submit {
    margin-top: 4px; padding: 12px 18px; border: none; border-radius: 10px; cursor: pointer;
    background: var(--accent, #4d9eff); color: #fff; font-weight: 700; font-size: 15px;
  }
  .bdf-submit:disabled { opacity: 0.6; cursor: default; }
  .bdf-success { text-align: center; padding: 12px 4px; }
  .bdf-success-icon {
    width: 48px; height: 48px; margin: 0 auto 12px; border-radius: 999px; display: grid; place-items: center;
    background: var(--surface-cyan-soft, rgba(0,229,204,0.14)); color: var(--cyan-bright, #00e5cc); font-size: 24px; font-weight: 800;
  }
  .bdf-success-title { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: var(--text-primary, #f0f4ff); }
  .bdf-success-body { margin: 0; color: var(--text-secondary, #aab3c5); font-size: 14px; }
`;
