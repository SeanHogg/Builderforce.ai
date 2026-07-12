'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageContainer, { READABLE_MAX } from '@/components/PageContainer';
import type { ImportFileType, ParsedFileResult, DryRunValidation } from '@/lib/importHelpers';

/**
 * Import input modes: guided (interactive) vs bulk (file import).
 */
type ImportMode = 'guided' | 'bulk';

/**
 * Guided mode step type.
 */
type GuidedStep = 'step-info' | 'step-fields' | 'step-review' | 'step-success';

/**
 * Initial guided form state.
 */
const initialGuidedState = {
  step: 'step-info' as GuidedStep,
  record: {} as Record<string, string | null>,
  error: {} as Record<string, string>,
  touched: new Set<string>(),
};

/**
 * Initial bulk state.
 */
const initialBulkState = {
  fileType: null as ImportFileType | null,
  file: null as File | null,
  rowsCount: 0,
  columns: [] as string[],
  mappings: {} as Record<string, string | null>,
  dryRunResult: null as DryRunValidation | null,
  uploading: false,
  importStatus: 'idle' as 'idle' | 'uploading' | 'mapping' | 'dryrun' | 'importing' | 'done',
  totalRows: 0,
  validRowsCount: 0,
  erroredRowsCount: 0,
  importSummary: null as string | null,
  errorMessage: null as string | null,
};

export default function ImportPage() {
  const t = useTranslations('import');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<ImportMode>('guided');
  const [isDragging, setIsDragging] = useState(false);

  const guidedStateRef = useRef({ ...initialGuidedState });
  const bulkStateRef = useRef({ ...initialBulkState });

  // Persist mode in URL query param (FR-1.2)
  useEffect(() => {
    const currentMode = searchParams.get('mode') as ImportMode | null;
    if (currentMode === 'guided' || currentMode === 'bulk') {
      setMode(currentMode);
    }
  }, [searchParams]);

  const updateGuidedState = (updates: Partial<typeof guidedStateRef.current>) => {
    guidedStateRef.current = { ...guidedStateRef.current, ...updates };
    setGuidedState(guidedStateRef.current);
  };

  const [guidedState, setGuidedState] = useState(initialGuidedState);

  const updateBulkState = (updates: Partial<typeof bulkStateRef.current>) => {
    bulkStateRef.current = { ...bulkStateRef.current, ...updates };
    setBulkState(bulkStateRef.current);
  };

  const [bulkState, setBulkState] = useState(initialBulkState);

  const handleModeChange = (newMode: ImportMode) => {
    if (bulkStateRef.current.file && newMode === 'guided') {
      // Wipe file data when switching to guided to avoid confusion
      updateBulkState({
        fileType: null,
        file: null,
        rowsCount: 0,
        columns: [],
        mappings: {},
        dryRunResult: null,
        uploadStatus: 'idle',
        totalRows: 0,
        validRowsCount: 0,
        erroredRowsCount: 0,
        importSummary: null,
        errorMessage: null,
      });
    }
    setMode(newMode);
    // Update URL without reloading
    router.replace(`?mode=${newMode}`);
  };

  // Toggle drag-and-drop state
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // Return from success back to page with mode preserved
  const handleContinue = () => {
    // Reset to initial state for next import
    setGuidedState(initialGuidedState);
    updateBulkState({ ...initialBulkState, fileType: mode === 'bulk' ? bulkState.fileType : null });
  };

  return (
    <PageContainer style={{ maxWidth: READABLE_MAX }}>
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <h1>{mode === 'guided' ? t('guided.title') : t('bulk.title')}</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
          {mode === 'guided' ? t('guided.description') : t('bulk.description')}
        </p>
      </div>

      {/* Mode selection (FR-1) */}
      <div className="mode-selector" style={{ marginBottom: '32px' }}>
        <label style={{ fontWeight: '600', display: 'block', marginBottom: '8px' }}>
          {t('mode.label')}
        </label>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleModeChange('guided')}
            style={{
              padding: '12px 24px',
              border:
                mode === 'guided'
                  ? '2px solid var(--primary-color)'
                  : '2px solid var(--border-color)',
              borderRadius: '6px',
              background: mode === 'guided' ? 'var(--primary-bg)' : 'transparent',
              cursor: mode === 'guided' ? 'pointer' : 'default',
              fontWeight: mode === 'guided' ? '600' : '400',
              fontFamily: 'inherit',
              fontSize: '0.95rem',
            }}
          >
            {t('mode.guided')}
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('bulk')}
            style={{
              padding: '12px 24px',
              border:
                mode === 'bulk'
                  ? '2px solid var(--primary-color)'
                  : '2px solid var(--border-color)',
              borderRadius: '6px',
              background: mode === 'bulk' ? 'var(--primary-bg)' : 'transparent',
              cursor: mode === 'bulk' ? 'pointer' : 'default',
              fontWeight: mode === 'bulk' ? '600' : '400',
              fontFamily: 'inherit',
              fontSize: '0.95rem',
            }}
          >
            {t('mode.bulk')}
          </button>
        </div>
      </div>

      {/* Mode-specific content */}
      {mode === 'guided' ? (
        <GuidedWizard state={guidedState} updateState={updateGuidedState} onCancel={() => router.back()} />
      ) : (
        <BulkImporter state={bulkState} updateState={updateBulkState} onCancel={() => router.back()} />
      )}
    </PageContainer>
  );
}

/**
 * Guided (Interactive) Wizard Component
 * Implements FR-2: multi-step interactive form with inline validation and review step
 */
function GuidedWizard({
  state,
  updateState,
  onCancel,
}: {
  state: typeof initialGuidedState;
  updateState: (updates: Partial<typeof state>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('import');

  const handleFieldChange = (field: string, value: string | null) => {
    updateState({ record: { ...state.record, [field]: value } });
    // Clear error for this field on change (FR-2.3)
    updateState({ error: { ...state.error, [field]: null } });
  };

  const handleFieldBlur = (field: string) => {
    updateState({ touched: new Set(state.touched).add(field) });
  };

  const validateStep = (): boolean => {
    // Check required fields
    const requiredFields = ['name'];
    const newError = { ...state.error };
    let isValid = true;

    for (const field of requiredFields) {
      const value = (state.record[field] ?? '').trim();
      if (value === '') {
        newError[field] = t(`guided.errors.${field}`);
        isValid = false;
      } else {
        newError[field] = null;
      }
    }

    if (!isValid) {
      updateState({ error: newError });
    }

    return isValid;
  };

  const handleNextStep = () => {
    if (state.step === 'step-fields') {
      // Validate before advancing to review (FR-2.3)
      if (!validateStep()) return;
    }

    const availableSteps: GuidedStep[] = ['step-info', 'step-fields', 'step-review', 'step-success'];
    const currentIndex = availableSteps.indexOf(state.step);
    const nextStep = availableSteps[currentIndex + 1];

    if (nextStep) {
      updateState({ step: nextStep });
    }
  };

  const handlePreviousStep = () => {
    const availableSteps: GuidedStep[] = ['step-info', 'step-fields', 'step-review', 'step-success'];
    const currentIndex = availableSteps.indexOf(state.step);
    const prevStep = availableSteps[currentIndex - 1];

    setGuidedStepState(prevStep);
  };

  const setGuidedStepState = (step: GuidedStep) => {
    const currentRecord = state.record;
    setState((prev) => ({ ...prev, step }));
    localStorage.setItem('guided-mode-record', JSON.stringify(currentRecord));
  };

  return (
    <>
      {/* Progress indicator (FR-2.1) */}
      <div className="progress-indicator" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
          <span>Step {state.step === 'step-info' ? 0 : state.step === 'step-fields' ? 1 : 2} of 3</span>
          <span style={{ color: 'var(--text-muted)' }}>{t('guided.steps.progress')}</span>
        </div>
        <div
          style={{
            width: `calc(100% - 16px)`,
            height: '4px',
            backgroundColor: 'var(--border-color)',
            marginTop: '8px',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${((state.step === 'step-info' ? 0 : state.step === 'step-fields' ? 1 : 2) / 3) * 100}%`,
              height: '100%',
              backgroundColor: 'var(--primary-color)',
            }}
          />
        </div>
      </div>

      {/* Step content */}
      {state.step === 'step-info' && (
        <StepInfo
          onNext={handleNextStep}
          onCancel={onCancel}
          helpText={t('guided.steps.info.help')}
        />
      )}

      {state.step === 'step-fields' && (
        <StepFields
          record={state.record}
          error={state.error}
          touched={state.touched}
          onChange={handleFieldChange}
          onBlur={handleFieldBlur}
          onNext={handleNextStep}
          onCancel={onCancel}
          helpText={t('guided.steps.fields.help')}
        />
      )}

      {state.step === 'step-review' && (
        <StepReview
          record={state.record}
          onBack={handlePreviousStep}
          onSubmit={handleNextStep}
          onCancel={onCancel}
        />
      )}

      {state.step === 'step-success' && (
        <StepSuccess onContinue={handleContinue} summary={state.record.name} />
      )}

      {/* Navigation buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
        {state.step !== 'step-info' && state.step !== 'step-success' && (
          <button type="button" onClick={handlePreviousStep} style={{ padding: '8px 16px' }}>
            {t('guided.buttons.back')}
          </button>
        )}

        {state.step !== 'step-success' && (
          <button
            type="button"
            onClick={handleNextStep}
            style={{
              padding: '8px 16px',
              backgroundColor: state.step === 'step-review' ? 'var(--primary-color)' : 'transparent',
              color: state.step === 'step-review' ? 'white' : 'var(--primary-color)',
              border: state.step === 'step-review' ? 'none' : '1px solid var(--primary-color)',
              borderRadius: '6px',
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            {t('guided.buttons.next', { step: ['Info', 'Fields', 'Review'][availableSteps.indexOf(state.step)] })}
          </button>
        )}
      </div>
    </>
  );
}

function availableSteps = ['step-info', 'step-fields', 'step-review'];