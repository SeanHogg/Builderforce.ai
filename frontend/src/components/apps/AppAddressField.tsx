/**
 * THE ADDRESS FIELD — "is this name free?", answered while it is typed.
 *
 * ── WHY THE SERVER ANSWERS EVERY KEYSTROKE ───────────────────────────────────
 * There is no client copy of `normalizeSubdomain` here and there must never be
 * one. The server owns what a label BECOMES ("Sunday RSVP" → `sunday-rsvp`),
 * which names are reserved by the platform, and which are already taken across
 * the whole hosting apex — a question no client can answer at all. So this asks,
 * and shows the server's normalised label back to the reader. The alternative is
 * a field that looks satisfied and a publish that fails.
 *
 * ── WHY DEBOUNCED AND NOT CACHED ─────────────────────────────────────────────
 * Debounced because a request per keystroke is a request per keystroke.
 * Uncached — matching the server, which refuses to cache this for the same
 * reason — because a cached "available" that outlives somebody else claiming the
 * name tells the creator they have it and then fails the conversion.
 *
 * The last response WINS ONLY IF IT IS STILL THE CURRENT INPUT: a slow answer
 * for "sun" must not overwrite a fast answer for "sunday", which is the classic
 * way a live validator ends up green on a taken name.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { embeddedAppsApi, type AddressAvailability } from '@/lib/embeddedApps';
import styles from './appPanels.module.css';

/** Long enough that a typist is not audited mid-word, short enough to feel live. */
const DEBOUNCE_MS = 350;

export interface AppAddressFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Reported upward so the convert button can refuse an address the server rejected. */
  onAvailability: (availability: AddressAvailability | null) => void;
  disabled?: boolean;
}

export function AppAddressField({ value, onChange, onAvailability, disabled }: AppAddressFieldProps) {
  const t = useTranslations('canvas.app');
  const [availability, setAvailability] = useState<AddressAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setAvailability(null);
      setChecking(false);
      onAvailability(null);
      return;
    }
    setChecking(true);
    let live = true;
    const timer = setTimeout(() => {
      embeddedAppsApi.addressAvailable(trimmed)
        .then((next) => {
          if (!live) return;
          setAvailability(next);
          onAvailability(next);
        })
        .catch(() => {
          if (!live) return;
          // A 400 IS the answer — the label cannot become a DNS label. Reported
          // as `invalid` rather than swallowed, so the field says why.
          const rejected: AddressAvailability = { label: null, available: false, reason: 'invalid', host: null };
          setAvailability(rejected);
          onAvailability(rejected);
        })
        .finally(() => { if (live) setChecking(false); });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
    // `onAvailability` is recreated by most parents each render; the VALUE is the
    // identity of this check, and re-running on a new callback would re-ask the
    // server the same question on every keystroke of an unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const verdict = (): { text: string; className: string } | null => {
    if (!value.trim()) return null;
    if (checking) return { text: t('addressChecking'), className: styles.verdictChecking };
    if (!availability) return null;
    if (availability.reason === 'taken') {
      return { text: t('addressTaken', { label: availability.label ?? value }), className: styles.verdictBad };
    }
    if (availability.reason === 'reserved') return { text: t('addressReserved'), className: styles.verdictBad };
    if (!availability.label) return { text: t('addressInvalid'), className: styles.verdictBad };
    return { text: t('addressFree', { host: availability.host ?? availability.label }), className: styles.verdictOk };
  };

  const shown = verdict();

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor="app-address">{t('addressLabel')}</label>
      <div className={styles.fieldRow}>
        <input
          id="app-address"
          className={styles.input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('addressPlaceholder')}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="app-address-verdict"
        />
      </div>
      {/* Always rendered so the verdict is announced rather than appearing from
          nowhere for a screen reader. */}
      <p id="app-address-verdict" className={`${styles.verdict} ${shown?.className ?? ''}`} role="status">
        {shown ? shown.text : t('addressHint')}
      </p>
    </div>
  );
}
