import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplaySiteSettings } from '@builderforce/interaction-contract';
import { Button, TextField } from '@/components/ui';
import styles from './capability.module.css';

/** The editable half of a site — what set-up creates and the Sites panel changes. */
export interface SiteDraft {
  label: string;
  allowedOrigins: string[];
  settings: ReplaySiteSettings;
}

type BooleanSetting = { [K in keyof ReplaySiteSettings]-?: ReplaySiteSettings[K] extends boolean ? K : never }[keyof ReplaySiteSettings];

/** The privacy switches, as data — each is a boolean on `ReplaySiteSettings`. */
export const PRIVACY_SWITCHES: ReadonlyArray<BooleanSetting> = ['maskAllText', 'consentRequired', 'recordCanvas', 'identify'];

/**
 * `shop.example.com`, `https://shop.example.com/path` → `https://shop.example.com`.
 * Null for anything that is not a web origin.
 */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function SiteSettingsForm({ value, onChange, showLabel = true, showDomains = true }: {
  value: SiteDraft;
  onChange: (next: SiteDraft) => void;
  showLabel?: boolean;
  /** A hosted app's origin is its own subdomain — nothing to allow. */
  showDomains?: boolean;
}) {
  const t = useTranslations('marketplace.capability.site');
  const id = useId();
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);

  const addDomain = () => {
    const origin = normalizeOrigin(domain);
    if (!origin) { setDomainError(t('domainInvalid')); return; }
    setDomainError(null);
    setDomain('');
    if (!value.allowedOrigins.includes(origin)) onChange({ ...value, allowedOrigins: [...value.allowedOrigins, origin] });
  };

  return (
    <div className={styles.stack}>
      {showLabel && (
        <TextField
          id={`${id}-label`}
          label={t('label')}
          value={value.label}
          maxLength={200}
          onChange={(event) => onChange({ ...value, label: event.target.value })}
        />
      )}
      {showDomains && <div className={styles.stack}>
        <label className={styles.switchLabel} htmlFor={`${id}-domain`}>{t('domains')}</label>
        <ul className={styles.chips} aria-label={t('domains')}>
          {value.allowedOrigins.map((origin) => (
            <li key={origin} className={styles.chip}>
              {origin}
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={t('removeDomain', { domain: origin })}
                onClick={() => onChange({ ...value, allowedOrigins: value.allowedOrigins.filter((o) => o !== origin) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.row}>
          <input
            id={`${id}-domain`}
            className={styles.input}
            style={{ flex: '1 1 200px', width: 'auto' }}
            value={domain}
            placeholder={t('domainPlaceholder')}
            onChange={(event) => setDomain(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDomain(); } }}
          />
          <Button variant="secondary" onClick={addDomain}>{t('addDomain')}</Button>
        </div>
        {domainError && <p className={styles.error} role="alert">{domainError}</p>}
      </div>}
      <fieldset className={styles.switches} style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className={styles.switchLabel}>{t('privacy')}</legend>
        {PRIVACY_SWITCHES.map((key) => (
          <label key={key} className={styles.switch}>
            <span className={styles.switchText}>
              <span className={styles.switchLabel}>{t(`switches.${key}.label` as never)}</span>
              <span className={styles.switchHint}>{t(`switches.${key}.hint` as never)}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className={styles.switchInput}
              checked={value.settings[key]}
              onChange={(event) => onChange({ ...value, settings: { ...value.settings, [key]: event.target.checked } })}
              data-setting={key}
            />
          </label>
        ))}
      </fieldset>
    </div>
  );
}
