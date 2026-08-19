/**
 * One settings field, drawn once for whichever surface asked for it.
 *
 * The panel's short reading and its wide one used to hand-write the same five controls
 * (text, textarea, select, number, color) twice, in two files, with two chances to drift
 * on what "disabled" means. This is the ONE place a `SettingsField`
 * becomes a control — see `lib/canvasKindSettings.ts` for why the field vocabulary is
 * its own thing and not a reuse of `SpecField`.
 */

import type { SettingsField } from '@/lib/canvasKindSettings';
import type { CreationNodeData } from './types';
import { AUTHORED_COLOR_FALLBACK } from './authoredColors';
import styles from './CreationCanvas.module.css';

export function SettingsFieldControl({
  field,
  data,
  editable,
  variant,
  translate,
  onChange,
}: {
  field: SettingsField;
  data: CreationNodeData;
  /** Whether the session role allows changes at all — ANDed with the field's own
   *  `editable(data)`, e.g. a builtin seat's name locked regardless of role. */
  editable: boolean;
  variant: 'compact' | 'full';
  /**
   * Resolves a `labelKey`/`placeholderKey`/`fallbackKey` to display text. Injected
   * rather than called internally with a fixed namespace, because the short reading's
   * labels live under `creationCanvas.nodePanel` and the wide one's under plain
   * `creationCanvas` — the SAME field name (`name`, `role`, `model`…) resolving through
   * two different catalogs is exactly why this is the caller's `t`, not this file's.
   */
  translate: (key: string) => string;
  onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = translate;
  const disabled = !editable || (field.editable ? !field.editable(data) : false);
  const label = t(field.labelKey as 'name');
  const placeholder = field.placeholderKey ? t(field.placeholderKey as 'name') : undefined;
  const rawValue = data[field.name];
  const value = typeof rawValue === 'string' && rawValue
    ? rawValue
    : field.fallbackKey ? t(field.fallbackKey as 'name') : field.fallbackField ? data[field.fallbackField] : rawValue;
  const write = (next: unknown) => onChange(field.toPatch ? field.toPatch(next) : { [field.name]: next });

  const control = (() => {
    switch (field.control) {
      case 'text':
        return <input
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => write(event.target.value)}
        />;
      case 'textarea':
        return <textarea
          rows={variant === 'compact' ? 3 : 6}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => write(event.target.value)}
        />;
      case 'select':
        return <select
          // `selectClassName` names a key into this module's own CSS-module `styles`
          // object — a literal class string would not survive the module's hashing.
          className={field.selectClassName ? styles[field.selectClassName as keyof typeof styles] : undefined}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => write(event.target.value)}
        >
          {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.labelKey ? t(option.labelKey as 'name') : option.label}</option>)}
        </select>;
      case 'number':
        return <input
          type="number"
          min={field.min}
          max={field.max}
          value={typeof value === 'number' ? value : ''}
          disabled={disabled}
          onChange={(event) => {
            const raw = Number(event.target.value);
            const clamped = field.min != null && field.max != null
              ? Math.max(field.min, Math.min(field.max, Number.isFinite(raw) ? raw : field.min))
              : raw;
            write(clamped);
          }}
        />;
      case 'checkbox':
        return <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => write(event.target.checked)}
        />;
      case 'color':
        return <input
          type="color"
          value={typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : (field.defaultColor ?? AUTHORED_COLOR_FALLBACK)}
          disabled={disabled}
          onChange={(event) => write(event.target.value)}
        />;
      default:
        return null;
    }
  })();

  if (variant === 'compact') {
    return <label className={styles.anchoredField}><span>{label}</span>{control}</label>;
  }
  return <label>{label}{control}</label>;
}
