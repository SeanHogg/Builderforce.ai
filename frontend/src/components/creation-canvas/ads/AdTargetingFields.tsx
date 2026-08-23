'use client';

/**
 * WHO the money is spent on — the targeting spec, as a form.
 *
 * The vocabulary is the server's (`adTargeting.ts`), and the reason this component
 * exists rather than a free-text box is the reason that module exists: a dimension a
 * network cannot place is REFUSED BY NAME rather than dropped, because an audience that
 * silently widens from "under-25s in Germany" to "everyone, everywhere" spends the whole
 * budget correctly on the wrong people and looks healthy in every report while it does.
 *
 * So this form offers ONLY the dimensions the chosen account declares it can place. A
 * network without device targeting has no device control here — not a disabled one, and
 * certainly not an enabled one that 400s on submit. That is the same refusal
 * `requireTargetingSupport` makes on the write path, made early enough to be useful.
 *
 * Controlled and stateless: the spec lives in the form that will submit it, so a create
 * form and an edit form use the same component with no mode flag between them.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import {
  AD_DEVICES, AD_GENDERS, AD_MAX_AGE, AD_MIN_AGE, AD_PLACEMENTS,
  normalizeGenders,
  type AdDevice, type AdGender, type AdPlacement, type AdTargeting, type AdTargetingDimension,
} from '@/lib/adSetsApi';

export interface AdTargetingFieldsProps {
  value: AdTargeting;
  onChange: (next: AdTargeting) => void;
  /** What this network can actually place. Rendering anything else would be a control
   *  whose only outcome is a refusal — see the header. */
  dimensions: readonly AdTargetingDimension[];
  /** Disable every control while the form's own action is in flight. */
  disabled?: boolean;
}

/** A stable empty list, so an absent dimension does not hand `ListField` a new array
 *  identity on every render and re-run its sync effect for nothing. */
const EMPTY_LIST: readonly string[] = [];

/** A comma-separated list → the trimmed, de-duplicated entries the wire wants. */
function listFrom(text: string, transform: (entry: string) => string = (entry) => entry): string[] {
  return [...new Set(text.split(',').map((entry) => transform(entry.trim())).filter(Boolean))];
}

/** Whole numbers only, and only inside the window every network shares. Out-of-range
 *  input is dropped rather than clamped: clamping answers a question nobody asked. */
function ageFrom(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const age = Number(text);
  return Number.isInteger(age) && age >= AD_MIN_AGE && age <= AD_MAX_AGE ? age : undefined;
}

/**
 * A comma-separated list, typed one character at a time.
 *
 * The text is LOCAL state and the parsed list is what leaves. Binding the input
 * straight to `value.join(', ')` looks equivalent and is not: parsing on every
 * keystroke drops the empty entry after the comma the person just typed, so the comma
 * vanishes from under the cursor and a two-country audience cannot be entered at all.
 *
 * Re-syncs only when the incoming list differs from the one this field last EMITTED —
 * that distinguishes a genuine outside change (a form reset, an existing spec loaded
 * for editing) from the echo of the caller re-rendering with what was just typed.
 */
function ListField({ label, help, placeholder, value, transform, disabled, onChange }: {
  label: string;
  help: string;
  placeholder: string;
  value: readonly string[];
  transform?: (entry: string) => string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState(value.join(', '));
  const emitted = useRef(value.join(','));

  useEffect(() => {
    const incoming = value.join(',');
    if (incoming === emitted.current) return;
    emitted.current = incoming;
    setText(value.join(', '));
  }, [value]);

  return (
    <label>
      <span>{label}</span>
      <input
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        {...(transform ? { autoCapitalize: 'characters' as const } : {})}
        onChange={(event) => {
          setText(event.target.value);
          const list = listFrom(event.target.value, transform);
          emitted.current = list.join(',');
          onChange(list);
        }}
      />
      <small>{help}</small>
    </label>
  );
}

/**
 * A multi-select over one closed vocabulary.
 *
 * Checkboxes rather than a multi-select `<select>`: three of these render one under the
 * other in a 300px panel, where a native multi-select is a scrolling box whose selection
 * is invisible until it is opened.
 */
function CheckGroup<T extends string>({ legend, options, selected, label, disabled, onToggle }: {
  legend: string;
  options: readonly T[];
  selected: readonly T[];
  label: (option: T) => string;
  disabled?: boolean;
  onToggle: (option: T, checked: boolean) => void;
}) {
  return (
    <fieldset className={styles.adTargetChecks} disabled={disabled}>
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option}>
          <input
            type="checkbox"
            checked={selected.includes(option)}
            onChange={(event) => onToggle(option, event.target.checked)}
          />
          <span>{label(option)}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function AdTargetingFields({ value, onChange, dimensions, disabled }: AdTargetingFieldsProps) {
  const t = useTranslations('canvas.ads.targeting');

  // A network that can place nothing this vocabulary names gets no form at all rather
  // than an empty box implying an audience could be set here.
  if (dimensions.length === 0) return null;

  const patch = (next: Partial<AdTargeting>) => onChange({ ...value, ...next });

  /** Toggle one member of a closed list, dropping the key entirely when nothing is
   *  left — an empty array is not "no audience", it is "unrestricted", and the wire
   *  says that by omission. */
  const toggle = <T extends string>(current: readonly T[] | undefined, option: T, checked: boolean): T[] | undefined => {
    const next = checked
      ? [...(current ?? []), option]
      : (current ?? []).filter((entry) => entry !== option);
    return next.length > 0 ? next : undefined;
  };

  return (
    <>
      {dimensions.includes('geo') && (
        <ListField
          label={t('countries')}
          help={t('countriesHelp')}
          placeholder={t('countriesPlaceholder')}
          value={value.countries ?? EMPTY_LIST}
          transform={(entry) => entry.toUpperCase()}
          disabled={disabled}
          onChange={(countries) => patch({ countries })}
        />
      )}

      {dimensions.includes('age') && (
        <fieldset className={styles.adTargetRange} disabled={disabled}>
          <legend>{t('age')}</legend>
          <label>
            <span>{t('ageMin')}</span>
            <input
              type="number" inputMode="numeric" min={AD_MIN_AGE} max={AD_MAX_AGE} step="1"
              value={value.ageMin ?? ''}
              onChange={(event) => patch({ ageMin: ageFrom(event.target.value) })}
            />
          </label>
          <label>
            <span>{t('ageMax')}</span>
            <input
              type="number" inputMode="numeric" min={AD_MIN_AGE} max={AD_MAX_AGE} step="1"
              value={value.ageMax ?? ''}
              onChange={(event) => patch({ ageMax: ageFrom(event.target.value) })}
            />
          </label>
          {/* Several networks sell age in FIXED buckets and refuse a window that does
              not land on one, naming the boundaries — so the refusal is worth reading
              rather than hiding behind a slider that implies any window is buyable. */}
          <small>{t('ageHelp', { min: AD_MIN_AGE, max: AD_MAX_AGE })}</small>
        </fieldset>
      )}

      {dimensions.includes('gender') && (
        <CheckGroup
          legend={t('genders')}
          options={AD_GENDERS}
          selected={value.genders ?? []}
          label={(option: AdGender) => t(`gender.${option}`)}
          disabled={disabled}
          onToggle={(option, checked) => patch({
            // Every gender ticked is the DEFAULT, not a constraint — normalizing here
            // keeps the form and the stored spec from disagreeing about what was asked.
            genders: normalizeGenders(toggle(value.genders, option, checked) ?? []),
          })}
        />
      )}

      {dimensions.includes('interests') && (
        <ListField
          label={t('interests')}
          help={t('interestsHelp')}
          placeholder={t('interestsPlaceholder')}
          value={value.interests ?? EMPTY_LIST}
          disabled={disabled}
          onChange={(interests) => patch({ interests })}
        />
      )}

      {dimensions.includes('placements') && (
        <CheckGroup
          legend={t('placements')}
          options={AD_PLACEMENTS}
          selected={value.placements ?? []}
          label={(option: AdPlacement) => t(`placement.${option}`)}
          disabled={disabled}
          onToggle={(option, checked) => patch({ placements: toggle(value.placements, option, checked) })}
        />
      )}

      {dimensions.includes('devices') && (
        <CheckGroup
          legend={t('devices')}
          options={AD_DEVICES}
          selected={value.devices ?? []}
          label={(option: AdDevice) => t(`device.${option}`)}
          disabled={disabled}
          onToggle={(option, checked) => patch({ devices: toggle(value.devices, option, checked) })}
        />
      )}
    </>
  );
}
