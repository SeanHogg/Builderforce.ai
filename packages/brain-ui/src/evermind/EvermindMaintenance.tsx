/**
 * <EvermindMaintenance> — the repair-and-tidy controls for a project's model.
 *
 * Three operations that had no door in the product, each self-gating on whether its
 * host implements it:
 *
 *   REPLACE  — swap the weights for a fresh base (a published model, or a clean starter)
 *              as a new version. Seeding deliberately refuses to clobber a trained head,
 *              which meant a model that trained itself into gibberish could be
 *              quarantined but never fixed. This is the fix.
 *   REBUILD  — re-file every learned memory against the CURRENT model. Memories are
 *              filed with the model as it was when they were learned, while recall
 *              matches against today's model, so retrieval quality decays silently.
 *   CLEAN UP — discard what is queued but unlearned, and clear cached answers. Learned
 *              knowledge is never touched here (that is the analyzer's job).
 *
 * Replace and clean up are destructive, so both confirm INLINE: the button expands into
 * a warning plus Confirm/Cancel. Deliberately NOT `window.confirm` — a VS Code webview
 * does not implement it (the call returns undefined), so a native-dialog confirmation
 * would make both actions silently do nothing inside the editor. Buttons are disabled,
 * never hidden, for non-managers.
 */
import { useCallback, useState } from 'react';
import type { EvermindConsoleLabels, EvermindSeedModel } from './types';
import {
  C, fieldTitle, fieldHint, sectionBlock, select, optionStyle, warnBox,
  secondaryBtn, dangerBtn,
} from './consoleStyles';

export interface EvermindMaintenanceProps {
  t: EvermindConsoleLabels;
  disabled: boolean;
  /** Published models available as a replacement base; the starter base is always offered. */
  seedModels: EvermindSeedModel[];
  /** Replace the weights. `slug` omitted = a fresh starter base. */
  onReseed?: (slug?: string) => Promise<void>;
  onReindex?: () => Promise<void>;
  onCleanup?: () => Promise<void>;
}

/** Which destructive action is awaiting confirmation, if any. */
type Pending = 'reseed' | 'cleanup' | null;

export function EvermindMaintenance({
  t, disabled, seedModels, onReseed, onReindex, onCleanup,
}: EvermindMaintenanceProps) {
  // Empty string = the starter base (always available, even with no published models).
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState<Pending>(null);

  const doReseed = useCallback(async () => {
    setPending(null);
    await onReseed?.(slug || undefined);
  }, [onReseed, slug]);

  const doCleanup = useCallback(async () => {
    setPending(null);
    await onCleanup?.();
  }, [onCleanup]);

  // Self-gating: a host that implements none of these renders nothing at all.
  if (!onReseed && !onReindex && !onCleanup) return null;

  return (
    <div style={sectionBlock}>
      <div style={fieldTitle}>{t.maintenanceTitle}</div>
      <div style={fieldHint}>{t.maintenanceHint}</div>

      {onReindex && (
        <Row
          title={t.reindexLabel} hint={t.reindexHint}
          action={
            <button type="button" onClick={() => void onReindex()} disabled={disabled} style={secondaryBtn(disabled)}>
              {t.reindexCta}
            </button>
          }
        />
      )}

      {onCleanup && (
        <Row
          title={t.cleanupLabel} hint={t.cleanupHint}
          action={
            <button type="button" onClick={() => setPending('cleanup')} disabled={disabled || pending === 'cleanup'} style={secondaryBtn(disabled || pending === 'cleanup')}>
              {t.cleanupCta}
            </button>
          }
          confirm={pending === 'cleanup' ? (
            <Confirm
              message={t.cleanupConfirm} confirmLabel={t.cleanupCta} cancelLabel={t.validateClear}
              disabled={disabled} onConfirm={() => void doCleanup()} onCancel={() => setPending(null)}
            />
          ) : null}
        />
      )}

      {onReseed && (
        <Row
          title={t.reseedLabel} hint={t.reseedHint}
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
              <select
                value={slug} onChange={(e) => setSlug(e.target.value)} disabled={disabled}
                aria-label={t.reseedLabel} style={{ ...select, maxWidth: 200 }}
              >
                <option value="" style={optionStyle}>{t.reseedStarterOption}</option>
                {seedModels.map((m) => <option key={m.slug} value={m.slug} style={optionStyle}>{m.name}</option>)}
              </select>
              <button type="button" onClick={() => setPending('reseed')} disabled={disabled || pending === 'reseed'} style={dangerBtn(disabled || pending === 'reseed')}>
                {t.reseedCta}
              </button>
            </div>
          }
          confirm={pending === 'reseed' ? (
            <Confirm
              message={t.reseedConfirm} confirmLabel={t.reseedCta} cancelLabel={t.validateClear}
              danger disabled={disabled} onConfirm={() => void doReseed()} onCancel={() => setPending(null)}
            />
          ) : null}
        />
      )}
    </div>
  );
}

/** One maintenance row: what it does on the left, the control on the right, and the
 *  inline confirmation (when armed) spanning the full width beneath. Wraps to a single
 *  column on a narrow viewport (the VS Code sidebar is routinely < 320px). */
function Row({ title, hint, action, confirm }: { title: string; hint: string; action: React.ReactNode; confirm?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: C.text }}>{title}</div>
          <div style={fieldHint}>{hint}</div>
        </div>
        <div style={{ flex: '0 1 auto' }}>{action}</div>
      </div>
      {confirm}
    </div>
  );
}

/** Inline "are you sure" — the warning text plus the two choices, in the panel itself. */
function Confirm({
  message, confirmLabel, cancelLabel, danger, disabled, onConfirm, onCancel,
}: {
  message: string; confirmLabel: string; cancelLabel: string;
  danger?: boolean; disabled: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ ...warnBox, display: 'flex', flexDirection: 'column', gap: 8 }} role="alertdialog" aria-label={message}>
      <span>{message}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onConfirm} disabled={disabled} style={danger ? dangerBtn(disabled) : secondaryBtn(disabled)}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={disabled} style={secondaryBtn(disabled)}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
