'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon, Surface } from '@/components/ui';
import { useToast } from '@/components/ToastProvider';
import {
  DEFAULT_BEGINNER_STEP, defineGuidedSteps, fieldLabelKey, validateCell,
  type FieldDirective, type GuidedStep, type RecordKindInfo,
} from '@/lib/import-input-schema';
import { useGuidedImportSubmit } from '@/lib/useGuidedImportSubmit';
import { GuidedFieldInput } from './GuidedFieldInput';
import { ImportProgressBar } from './ImportProgressBar';
import { ImportResultSummary } from './ImportResultSummary';
import { cellErrorMessage } from './cellErrorMessage';
import { bodyText, buttonCluster, buttonRow, dangerText, errorBanner, h2Style, smallText } from './importStyles';

/**
 * Guided (interactive) wizard: one record at a time, each field checked as you
 * go, reviewed, then posted through `useGuidedImportSubmit`. The fields are the
 * kind's registry columns — nothing here knows a column by name.
 */
interface GuidedWizardProps {
  kind: RecordKindInfo;
  /** Whether there is unsaved input, so the page can guard leaving. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called when the user cancels (the page owns the confirm dialog). */
  onCancel: () => void;
}

const STEPS: GuidedStep[] = defineGuidedSteps();

const STEP_LABEL_KEYS: Record<GuidedStep, string> = {
  'step-info': 'stepInfo',
  'step-fields': 'stepFields',
  'step-review': 'stepReview',
  'step-success': 'stepSuccess',
};

export default function GuidedWizard({ kind, onDirtyChange, onCancel }: GuidedWizardProps) {
  const t = useTranslations('import');
  const tCommon = useTranslations('common');
  const toast = useToast();

  const [step, setStep] = useState<GuidedStep>(DEFAULT_BEGINNER_STEP);
  const [record, setRecord] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const { submit, submitting, result, reset } = useGuidedImportSubmit(kind.kind);

  const labelOf = useCallback((key: string) => t(fieldLabelKey(key)), [t]);

  const messageFor = useCallback((field: FieldDirective, value: string | undefined): string | null => {
    const code = validateCell(field, value ?? '');
    return code ? cellErrorMessage(t, code, labelOf(field.key), 'form') : null;
  }, [t, labelOf]);

  const updateField = useCallback((key: string, value: string) => {
    setRecord((prev) => {
      const next = { ...prev, [key]: value };
      onDirtyChange?.(Object.values(next).some((v) => v.trim() !== ''));
      return next;
    });
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _cleared, ...rest } = prev;
      return rest;
    });
  }, [onDirtyChange]);

  const handleBlur = useCallback((field: FieldDirective) => {
    setTouched((prev) => new Set(prev).add(field.key));
    const message = messageFor(field, record[field.key]);
    setErrors((prev) => {
      if (message) return { ...prev, [field.key]: message };
      const { [field.key]: _cleared, ...rest } = prev;
      return rest;
    });
  }, [messageFor, record]);

  const validateAll = useCallback((): boolean => {
    const next: Record<string, string> = {};
    for (const field of kind.fields) {
      const message = messageFor(field, record[field.key]);
      if (message) next[field.key] = message;
    }
    setErrors(next);
    setTouched(new Set(kind.fields.map((f) => f.key)));
    return Object.keys(next).length === 0;
  }, [kind.fields, messageFor, record]);

  const stepIndex = useMemo(() => STEPS.indexOf(step), [step]);
  const totalSteps = STEPS.length - 1; // success is final, not counted as a progress step

  const handleNext = useCallback(async () => {
    if (step === 'step-info') {
      setStep('step-fields');
    } else if (step === 'step-fields') {
      if (validateAll()) setStep('step-review');
    } else if (step === 'step-review') {
      const verdict = await submit(record);
      if (verdict && verdict.inserted > 0) {
        onDirtyChange?.(false);
        toast.success(t('guidedSubmitSuccess'));
        setStep('step-success');
      } else {
        toast.error(t('guidedSubmitError'));
      }
    }
  }, [step, validateAll, submit, record, onDirtyChange, toast, t]);

  const handleBack = useCallback(() => {
    const previous = STEPS[STEPS.indexOf(step) - 1];
    if (previous) setStep(previous);
  }, [step]);

  const handleCreateAnother = useCallback(() => {
    setRecord({});
    setErrors({});
    setTouched(new Set());
    reset();
    setStep('step-info');
    onDirtyChange?.(false);
  }, [reset, onDirtyChange]);

  const fieldError = (key: string): string | null => (touched.has(key) ? errors[key] ?? null : null);

  const progress = (
    <ImportProgressBar
      value={stepIndex}
      max={totalSteps}
      label={`${stepIndex} / ${totalSteps} · ${t(STEP_LABEL_KEYS[step])}`}
    />
  );

  // ── Step: info ──────────────────────────────────────────────
  if (step === 'step-info') {
    return (
      <div>
        {progress}
        <Surface padding="lg">
          <h2 style={h2Style}>{t('guidedInfoTitle')}</h2>
          <p style={bodyText}>{t('guidedInfoBody')}</p>
          <div style={buttonCluster}>
            <Button variant="primary" onClick={() => void handleNext()}>{t('next')}</Button>
            <Button variant="ghost" onClick={onCancel}>{tCommon('cancel')}</Button>
          </div>
        </Surface>
      </div>
    );
  }

  // ── Step: fields ────────────────────────────────────────────
  if (step === 'step-fields') {
    return (
      <div>
        {progress}
        <Surface padding="lg">
          <h2 style={h2Style}>{t('guidedFieldsTitle')}</h2>
          {kind.fields.map((field) => (
            <GuidedFieldInput
              key={field.key}
              field={field}
              value={record[field.key] ?? ''}
              error={fieldError(field.key)}
              onChange={(value) => updateField(field.key, value)}
              onBlur={() => handleBlur(field)}
            />
          ))}
          <div style={buttonRow}>
            <Button variant="secondary" onClick={handleBack}>{t('back')}</Button>
            <div style={buttonCluster}>
              <Button variant="ghost" onClick={onCancel}>{tCommon('cancel')}</Button>
              <Button variant="primary" onClick={() => void handleNext()}>{t('next')}</Button>
            </div>
          </div>
        </Surface>
      </div>
    );
  }

  // ── Step: review ────────────────────────────────────────────
  if (step === 'step-review') {
    const entries = kind.fields.filter((field) => (record[field.key] ?? '').trim() !== '');
    const declined = result && result.inserted === 0 ? result.errors : [];

    return (
      <div>
        {progress}
        <Surface padding="lg">
          <h2 style={h2Style}>{t('guidedReviewTitle')}</h2>
          <p style={bodyText}>{t('guidedReviewBody')}</p>

          <Surface tone="raised" padding="md" style={{ marginBottom: 'var(--space-6)' }}>
            {entries.map((field) => {
              const label = labelOf(field.key);
              const raw = record[field.key] ?? '';
              const value = field.type === 'bool' ? (raw === 'true' ? t('yes') : t('no')) : raw;
              return (
                <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--font-size-body)', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
                  <span style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span>{value}</span>
                    <Button variant="ghost" size="sm" onClick={() => setStep('step-fields')} aria-label={`${tCommon('edit')} ${label}`}>
                      {tCommon('edit')}
                    </Button>
                  </span>
                </div>
              );
            })}
          </Surface>

          {declined.length > 0 && (
            <div style={errorBanner} role="alert">
              <p style={{ ...smallText, ...dangerText, fontWeight: 600 }}>{t('guidedSubmitSkipped')}</p>
              <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-5)' }}>
                {declined.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>
          )}

          <div style={buttonRow}>
            <Button variant="secondary" onClick={handleBack}>{t('back')}</Button>
            <div style={buttonCluster}>
              <Button variant="ghost" onClick={onCancel}>{tCommon('cancel')}</Button>
              <Button variant="primary" onClick={() => void handleNext()} loading={submitting}>
                {submitting ? t('submitting') : t('submit')}
              </Button>
            </div>
          </div>
        </Surface>
      </div>
    );
  }

  // ── Step: success ───────────────────────────────────────────
  return (
    <Surface padding="lg" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 'var(--font-size-hero)', color: 'var(--success)', marginBottom: 'var(--space-4)' }} aria-hidden="true">
        <Icon source="✓" size="1em" />
      </div>
      <h2 style={h2Style}>{t('guidedSuccessTitle')}</h2>
      <p style={bodyText}>{t('guidedSuccessBodyKind')}</p>
      {result && <ImportResultSummary result={result} />}
      <Button variant="primary" onClick={handleCreateAnother}>{t('createAnother')}</Button>
    </Surface>
  );
}
