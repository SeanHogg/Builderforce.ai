'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import type { GuidedStep } from '@/lib/import-input-schema';
import { BASE_FIELDS } from '@/lib/import-input-schema';

/**
 * Guided (Interactive) Wizard Component
 * Implements FR-2: multi-step interactive form with inline validation, review, and confirmation.
 */

interface GuidedWizardProps {
  /** Values retained from a prior mode switch (FR-1.3). */
  initialValues?: Record<string, string | null>;
  /** Called whenever form data changes so the parent can persist for mode switching. */
  onDataChange?: (data: Record<string, string | null>) => void;
  /** Called when the user cancels (parent owns the confirm dialog). */
  onCancel: () => void;
}

const STEPS: GuidedStep[] = ['step-info', 'step-fields', 'step-review', 'step-success'];

const STEP_LABEL_KEYS: Record<GuidedStep, string> = {
  'step-info': 'stepInfo',
  'step-fields': 'stepFields',
  'step-review': 'stepReview',
  'step-success': 'stepSuccess',
};

export default function GuidedWizard({ initialValues, onDataChange, onCancel }: GuidedWizardProps) {
  const t = useTranslations('import');
  const confirmDialog = useConfirm();
  const toast = useToast();

  const [step, setStep] = useState<GuidedStep>('step-info');
  const [record, setRecord] = useState<Record<string, string | null>>({
    name: initialValues?.name ?? '',
    description: initialValues?.description ?? null,
    referenceId: initialValues?.referenceId ?? null,
    enabled: initialValues?.enabled ?? null,
    priority: initialValues?.priority ?? null,
    notes: initialValues?.notes ?? null,
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateRecord = useCallback(
    (field: string, value: string | null) => {
      setRecord((prev) => {
        const next = { ...prev, [field]: value };
        onDataChange?.(next);
        return next;
      });
      setErrors((prev) => ({ ...prev, [field]: null }));
    },
    [onDataChange],
  );

  const handleBlur = useCallback((field: string) => {
    setTouched((prev) => new Set(prev).add(field));
    // Validate on blur (FR-2.3)
    const value = record[field] ?? '';
    const requiredFields = Object.entries(BASE_FIELDS)
      .filter(([, f]) => f.required)
      .map(([k]) => k);

    if (requiredFields.includes(field)) {
      setErrors((prev) => {
        const trimmed = (value ?? '').trim();
        if (trimmed === '') {
          return { ...prev, [field]: t(`fieldErrors.${field}`) };
        }
        return { ...prev, [field]: null };
      });
    }
  }, [record, t]);

  const validateStep = useCallback((): boolean => {
    const requiredFields = Object.entries(BASE_FIELDS)
      .filter(([, f]) => f.required)
      .map(([k]) => k);

    const newErrors: Record<string, string | null> = {};
    let isValid = true;

    for (const field of requiredFields) {
      const value = record[field] ?? '';
      if (String(value).trim() === '') {
        newErrors[field] = t(`fieldErrors.${field}`);
        isValid = false;
      }
    }
    setErrors(newErrors);
    return isValid;
  }, [record, t]);

  const stepIndex = useMemo(() => STEPS.indexOf(step), [step]);
  const totalSteps = STEPS.length - 1; // success is final, not counted as a progress step

  const handleNext = useCallback(async () => {
    if (step === 'step-fields') {
      if (!validateStep()) return;
      setStep('step-review');
    } else if (step === 'step-review') {
      // Simulate submission
      setSubmitting(true);
      try {
        // In production, call API here
        await new Promise((r) => setTimeout(r, 600));
        const id = Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7);
        setReferenceId(id);
        setStep('step-success');
        toast.success(t('guidedSubmitSuccess'));
      } catch {
        toast.error(t('guidedSubmitError'));
      } finally {
        setSubmitting(false);
      }
    } else if (step === 'step-info') {
      setStep('step-fields');
    }
  }, [step, validateStep, t, toast]);

  const handleBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }, [step]);

  const handleCancel = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t('cancelTitle'),
      message: t('cancelMessage'),
      destructive: true,
      confirmLabel: t('discard'),
      cancelLabel: t('keepEditing'),
    });
    if (confirmed) onCancel();
  }, [confirmDialog, t, onCancel]);

  const handleCreateAnother = useCallback(() => {
    setRecord({ name: '', description: null, referenceId: null, enabled: null, priority: null, notes: null });
    setErrors({});
    setTouched(new Set());
    setReferenceId(null);
    setStep('step-info');
    onDataChange?.({});
  }, [onDataChange]);

  const fieldError = (key: string): string | null => {
    if (touched.has(key)) return errors[key] ?? null;
    return null;
  };

  const inputStyle = (hasError: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 12px',
    border: hasError ? '1px solid var(--coral-bright)' : '1px solid var(--border-subtle)',
    borderRadius: 8,
    fontSize: 14,
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
  });

  // ── Step: info ──────────────────────────────────────────────
  if (step === 'step-info') {
    return (
      <div>
        <ProgressBar current={stepIndex} total={totalSteps} labels={STEPS.map((s) => t(STEP_LABEL_KEYS[s]))} />
        <div style={cardStyle}>
          <h2 style={h2Style}>{t('guidedInfoTitle')}</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
            {t('guidedInfoBody')}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={handleNext} style={primaryBtnStyle}>
              {t('next')}
            </button>
            <button type="button" onClick={handleCancel} style={ghostBtnStyle}>
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: fields ────────────────────────────────────────────
  if (step === 'step-fields') {
    return (
      <div>
        <ProgressBar current={stepIndex} total={totalSteps} labels={STEPS.map((s) => t(STEP_LABEL_KEYS[s]))} />

        <div style={cardStyle}>
          <h2 style={h2Style}>{t('guidedFieldsTitle')}</h2>

          {/* Name (required) */}
          <FieldWrapper label={t('fieldName')} required tooltip={t('fieldTooltipName')} error={fieldError('name')}>
            <input
              type="text"
              value={record.name ?? ''}
              onChange={(e) => updateRecord('name', e.target.value)}
              onBlur={() => handleBlur('name')}
              style={inputStyle(!!fieldError('name'))}
              placeholder={t('fieldPlaceholderName')}
              aria-label={t('fieldName')}
              aria-required="true"
              aria-invalid={!!fieldError('name')}
            />
          </FieldWrapper>

          {/* Description */}
          <FieldWrapper label={t('fieldDescription')} tooltip={t('fieldTooltipDescription')} error={fieldError('description')}>
            <textarea
              value={record.description ?? ''}
              onChange={(e) => updateRecord('description', e.target.value)}
              onBlur={() => handleBlur('description')}
              rows={4}
              style={inputStyle(!!fieldError('description'))}
              placeholder={t('fieldPlaceholderDescription')}
              aria-label={t('fieldDescription')}
            />
          </FieldWrapper>

          {/* Reference ID */}
          <FieldWrapper label={t('fieldReferenceId')} tooltip={t('fieldTooltipReferenceId')} error={fieldError('referenceId')}>
            <input
              type="text"
              value={record.referenceId ?? ''}
              onChange={(e) => updateRecord('referenceId', e.target.value)}
              onBlur={() => handleBlur('referenceId')}
              style={inputStyle(!!fieldError('referenceId'))}
              placeholder={t('fieldPlaceholderReferenceId')}
              aria-label={t('fieldReferenceId')}
            />
          </FieldWrapper>

          {/* Enabled */}
          <FieldWrapper label={t('fieldEnabled')} tooltip={t('fieldTooltipEnabled')}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={record.enabled === 'true'}
                onChange={(e) => updateRecord('enabled', String(e.target.checked))}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>{t('fieldEnabledLabel')}</span>
            </label>
          </FieldWrapper>

          {/* Priority */}
          <FieldWrapper label={t('fieldPriority')} tooltip={t('fieldTooltipPriority')} error={fieldError('priority')}>
            <select
              value={record.priority ?? ''}
              onChange={(e) => updateRecord('priority', e.target.value || null)}
              style={inputStyle(!!fieldError('priority'))}
              aria-label={t('fieldPriority')}
            >
              <option value="">{t('fieldPlaceholderPriority')}</option>
              <option value="Low">{t('priorityLow')}</option>
              <option value="Medium">{t('priorityMedium')}</option>
              <option value="High">{t('priorityHigh')}</option>
            </select>
          </FieldWrapper>

          {/* Notes */}
          <FieldWrapper label={t('fieldNotes')} tooltip={t('fieldTooltipNotes')}>
            <textarea
              value={record.notes ?? ''}
              onChange={(e) => updateRecord('notes', e.target.value)}
              onBlur={() => handleBlur('notes')}
              rows={4}
              style={inputStyle(false)}
              placeholder={t('fieldPlaceholderNotes')}
              aria-label={t('fieldNotes')}
            />
          </FieldWrapper>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
            <button type="button" onClick={handleBack} style={secondaryBtnStyle}>
              {t('back')}
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" onClick={handleCancel} style={ghostBtnStyle}>
                {t('cancel')}
              </button>
              <button type="button" onClick={handleNext} style={primaryBtnStyle}>
                {t('next')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: review ────────────────────────────────────────────
  if (step === 'step-review') {
    const entries = Object.entries(BASE_FIELDS).filter(([k]) => {
      const v = record[k];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });

    return (
      <div>
        <ProgressBar current={stepIndex} total={totalSteps} labels={STEPS.map((s) => t(STEP_LABEL_KEYS[s]))} />

        <div style={cardStyle}>
          <h2 style={h2Style}>{t('guidedReviewTitle')}</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
            {t('guidedReviewBody')}
          </p>

          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 20, marginBottom: 24 }}>
            {entries.map(([key]) => {
              const field = BASE_FIELDS[key];
              const value = key === 'enabled'
                ? (record.enabled === 'true' ? t('yes') : t('no'))
                : record[key] ?? '—';
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 14 }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{field.label}</span>
                  <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span>{value}</span>
                    {/* FR-2.6 inline edit link */}
                    <button
                      type="button"
                      onClick={() => setStep('step-fields')}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}
                      aria-label={`${t('edit')} ${field.label}`}
                    >
                      {t('edit')}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" onClick={handleBack} style={secondaryBtnStyle}>
              {t('back')}
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" onClick={handleCancel} style={ghostBtnStyle}>
                {t('cancel')}
              </button>
              <button type="button" onClick={handleNext} disabled={submitting} style={primaryBtnStyle}>
                {submitting ? t('submitting') : t('submit')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: success ───────────────────────────────────────────
  return (
    <div>
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ fontSize: 48, color: 'var(--accent)', marginBottom: 16 }} aria-hidden="true">✓</div>
        <h2 style={h2Style}>{t('guidedSuccessTitle')}</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
          {t('guidedSuccessBody')}
        </p>

        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 20, marginBottom: 24, display: 'inline-block', minWidth: 300 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('referenceIdLabel')}
          </div>
          <div style={{ fontSize: 18, fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 700 }}>
            {referenceId}
          </div>
        </div>

        <div>
          <button type="button" onClick={handleCreateAnother} style={primaryBtnStyle}>
            {t('createAnother')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function ProgressBar({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <nav aria-label="Progress" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
        <span>{`${current} / ${total}`}</span>
        <span>{labels[current]}</span>
      </div>
      <div style={{ width: '100%', height: 4, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            width: `${((current) / Math.max(total, 1)) * 100}%`,
            height: '100%',
            background: 'var(--accent)',
            transition: 'width 0.3s ease',
            borderRadius: 2,
          }}
        />
      </div>
    </nav>
  );
}

function FieldWrapper({
  label, required, tooltip, error, children,
}: {
  label: string; required?: boolean; tooltip?: string; error?: string | null; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }} role="group" aria-labelledby={`field-label-${label}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <label id={`field-label-${label}`} style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
          {label}
          {required && <span style={{ color: 'var(--coral-bright)', marginLeft: 4 }} aria-hidden="true">*</span>}
        </label>
        {tooltip && (
          <span
            title={tooltip}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, borderRadius: '50%', background: 'var(--border-subtle)',
              fontSize: 11, color: 'var(--text-secondary)', cursor: 'help',
            }}
            aria-label={tooltip}
            tabIndex={0}
          >
            ?
          </span>
        )}
      </div>
      {children}
      {error && (
        <div style={{ color: 'var(--coral-bright)', fontSize: 13, marginTop: 4 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  padding: 24,
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  background: 'var(--bg-base)',
};

const h2Style: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  margin: '0 0 16px',
  color: 'var(--text-primary)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 22px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '10px 22px',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '10px 22px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};
