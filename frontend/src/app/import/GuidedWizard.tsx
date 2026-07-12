'use client';

import { useState } from 'react';

/**
 * Guided (Interactive) Wizard Component
 * Implements FR-2: multi-step interactive form with inline validation and review step
 */
export default function GuidedWizard({ userId, onCancel }: { userId: string | null; onCancel: () => void }) {
  // Profile: i18n integration (v1.1). For now use plain English to avoid build breakage from missing keys.
  const t = (key: string, fallback?: any): string => {
    try {
      return (window as any).__next_client_i18n__?.(key) || fallback || key;
    } catch (e) {
      return fallback || key;
    }
  };

  // Hardcoded English labels for now
  const modeLabel = 'Mode';
  const guidedLabel = 'Guided';
  const bulkLabel = 'Bulk';
  const errorText: Record<string, string> = {
    name: 'Name is required',
    description: 'Description is required',
    referenceId: 'Reference ID is required',
    enabled: 'Enabled is required',
    priority: 'Priority is required',
    notes: 'Notes is required',
  };

  const fieldTooltips: Record<string, string> = {
    name: 'Unique, human-readable name (no special characters)',
    description: 'Brief free-form description of the record (optional)',
    referenceId: 'External system reference (optional)',
    enabled: 'Toggle to enable/disable this record',
    priority: 'Low, Medium, or High priority',
    notes: 'Free-form notes',
  };

  // Step types per FR-2.1
  type Step = 'info' | 'fields' | 'review' | 'success';

  // Initial state
  const [step, setStep] = useState<Step>('info');
  const [record, setRecord] = useState<Record<string, string | null>>({
    name: '',
    description: null,
    referenceId: null,
    enabled: null,
    priority: null,
    notes: null,
  });

  // Validation state per FR-2.3 and per-field error tracking
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Success state (FR-2.7): unique reference ID
  const [referenceId, setReferenceId] = useState<string | null>(null);

  const layoutMaxWidth = 800; // Local constant for this wizard

  const requiredFields: Array<keyof typeof record> = ['name'];
  const errorLabels = errorText;
  const fieldHelp = fieldTooltips;

  const handleFieldChange = (field: keyof typeof record, value: string | null) => {
    setRecord((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: null }));
  };

  const handleFieldBlur = (field: keyof typeof record) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const validateStep = (): boolean => {
    const newErrors: Record<string, string> = {};
    let isValid = true;

    for (const field of requiredFields) {
      const value = record[field] ?? '';
      const trimmed = (value === null ? '' : value).trim();
      if (trimmed === '') {
        newErrors[field] = errorLabels[field];
        isValid = false;
      }
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleNextStep = () => {
    if (step === 'fields') {
      if (!validateStep()) return;
      // Simulate backend submission (FR-2.6 review step, FR-2.7 success confirmation)
      // In a full implementation, this would call an API endpoint
      setStep('review');
    } else if (step === 'review') {
      setStep('success');
      // Simulate success with a generated reference ID
      setReferenceId(Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 5));
    }
  };

  const handlePreviousStep = () => {
    if (step === 'success') {
      setStep('review');
    } else if (step === 'review') {
      setStep('fields');
    } else if (step === 'fields') {
      setStep('info');
    }
  };

  const handleCancel = () => {
    // FR-4.2: confirm dialog warning
    const confirmed = window.confirm(t('guided.buttons.cancelConfirmation'));
    if (confirmed) {
      onCancel();
    }
  };

  // Progress indicator (FR-2.1)
  const progressStep = step === 'info' ? 0 : step === 'fields' ? 1 : step === 'review' ? 2 : 3;
  const totalSteps = 3;

  return (
    <div style={{ maxWidth: layoutMaxWidth }}>
      {/* Progress indicator */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
          <span>Step {progressStep} of {totalSteps}</span>
        </div>
        <div
          style={{
            width: '100%',
            height: '4px',
            backgroundColor: 'var(--border-color)',
            marginTop: '8px',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${(progressStep / totalSteps) * 100}%`,
              height: '100%',
              backgroundColor: 'var(--primary-color)',
            }}
          />
        </div>
      </div>

      {/* Step 0: Info/Overview (step-info) */}
      {step === 'info' && (
        <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Welcome to the Guided Import</h2>
          <p style={{ color: 'var(--text-muted)' }}>Enter your record details step by step with guidance and validation.</p>
          <button
            onClick={handleNextStep}
            style={{
              marginTop: '24px',
              padding: '12px 24px',
              backgroundColor: 'var(--primary-color)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            Next: Fields
          </button>
        </div>
      )}

      {/* Step 1: Fields entry (step-fields) */}
      {step === 'fields' && (
        <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Enter Record Details</h2>

          {/* Name (required) */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontWeight: '600', marginBottom: '8px', display: 'block' }}>
              Name <span style={{ color: 'red' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="Enter the record name"
              value={record.name ?? ''}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              onBlur={() => handleFieldBlur('name')}
              style={{
                width: '100%',
                padding: '10px',
                border: errors.name ? '1px solid red' : '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '0.95rem',
              }}
            />
            {errors.name && <div style={{ color: 'red', fontSize: '0.88rem', marginTop: '4px' }}>{errors.name}</div>}
          </div>

          {/* Description */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontWeight: '600', marginBottom: '8px', display: 'block' }}>
              Description
            </label>
            <textarea
              placeholder="Enter a brief description"
              value={record.description ?? ''}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              onBlur={() => handleFieldBlur('description')}
              rows={4}
              style={{
                width: '100%',
                padding: '10px',
                border: errors.description ? '1px solid red' : '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '0.95rem',
              }}
            />
            {errors.description && (
              <div style={{ color: 'red', fontSize: '0.88rem', marginTop: '4px' }}>{errors.description}</div>
            )}
            {record.description && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Think of 1–2 lines to summarize this record.
              </div>
            )}
          </div>

          {/* Reference ID */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontWeight: '600', marginBottom: '8px', display: 'block' }}>
              Reference ID
            </label>
            <input
              type="text"
              placeholder="e.g. GHI-2024-001"
              value={record.referenceId ?? ''}
              onChange={(e) => handleFieldChange('referenceId', e.target.value)}
              onBlur={() => handleFieldBlur('referenceId')}
              style={{
                width: '100%',
                padding: '10px',
                border: errors.referenceId ? '1px solid red' : '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '0.95rem',
              }}
            />
            {errors.referenceId && (
              <div style={{ color: 'red', fontSize: '0.88rem', marginTop: '4px' }}>{errors.referenceId}</div>
            )}
          </div>

          {/* Enabled toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '8px' }}>Enabled</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={record.enabled === true}
                onChange={(e) => handleFieldChange('enabled', String(e.target.checked))}
                style={{ fontSize: '1rem' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>Enable this record</span>
            </div>
          </div>

          {/* Priority */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '8px' }}>Priority</label>
            <select
              value={record.priority ?? ''}
              onChange={(e) => handleFieldChange('priority', e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                border: errors.priority ? '1px solid red' : '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '0.95rem',
              }}
            >
              <option value="">Select a priority</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
            {errors.priority && (
              <div style={{ color: 'red', fontSize: '0.88rem', marginTop: '4px' }}>{errors.priority}</div>
            )}
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '8px' }}>Notes</label>
            <textarea
              placeholder="Add any additional notes"
              value={record.notes ?? ''}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              onBlur={() => handleFieldBlur('notes')}
              rows={4}
              style={{
                width: '100%',
                padding: '10px',
                border: errors.notes ? '1px solid red' : '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '0.95rem',
              }}
            />
            {errors.notes && (
              <div style={{ color: 'red', fontSize: '0.88rem', marginTop: '4px' }}>{errors.notes}</div>
            )}
          </div>

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={handlePreviousStep}
              style={{ padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
            >
              {t('guided.buttons.back')}
            </button>
            <button
              onClick={handleNextStep}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--primary-color)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {t('guided.buttons.next', { step: 'Fields' })}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review (step-review) */}
      {step === 'review' && (
        <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Review Your Record</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Please confirm the details below before submitting.</p>

          <div style={{ padding: '16px', backgroundColor: 'var(--bg-deep)', borderRadius: '8px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Record Details</h3>
            <div style={{ fontSize: '0.95rem' }}>
              <div style={{ marginBottom: '8px' }}>
                {/* Inline edit link per section */}
                <strong>Name:</strong> <span>{record.name} <a href="#" style={{ color: 'var(--primary-color)', marginLeft: '12px' }}></a></span>
              </div>
              {record.description && (
                <div style={{ marginBottom: '8px' }}>
                  <strong>Description:</strong> <span>{record.description}</span>
                </div>
              )}
              {record.referenceId && (
                <div style={{ marginBottom: '8px' }}>
                  <strong>Reference ID:</strong> <span>{record.referenceId}</span>
                </div>
              )}
              <div style={{ marginBottom: '8px' }}>
                <strong>Enabled:</strong> <span>{record.enabled ? 'Yes' : 'No'}</span>
              </div>
              {record.priority && (
                <div style={{ marginBottom: '8px' }}>
                  <strong>Priority:</strong> <span>{record.priority}</span>
                </div>
              )}
              {record.notes && (
                <div style={{ marginBottom: '8px' }}>
                  <strong>Notes:</strong> <span>{record.notes}</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              onClick={handlePreviousStep}
              style={{ padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
            >
              Edit
            </button>
            <button
              onClick={handleNextStep}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--primary-color)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Success (step-success) - FR-2.7 */}
      {step === 'success' && (
        <div style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', color: 'green', marginBottom: '16px' }}>✓</div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>{t('guided.steps.success.title')}</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>{t('guided.steps.success.description')}</p>

          <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '24px' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{t('guided.steps.success.referenceId')}</div>
            <div style={{ fontSize: '1.2rem', fontFamily: 'monospace' }}>{referenceId}</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={handleNextStep}
              style={{
                padding: '12px 24px',
                backgroundColor: 'var(--primary-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              {t('guided.buttons.createAnother')}
            </button>
          </div>
        </div>
      )}

      {/* Navigation bar */}
      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between' }}>
        {step !== 'info' && (
          <button
            onClick={handlePreviousStep}
            style={{ padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
          >
            {t('guided.buttons.back')}
          </button>
        )}
        {step !== 'success' && (
          <button
            onClick={handleCancel}
            style={{
              padding: '8px 16px',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {t('guided.buttons.cancel')}
          </button>
        )}
        {step !== 'info' && step !== 'success' && (
          <button
            onClick={handleNextStep}
            style={{
              padding: '8px 16px',
              backgroundColor: step === 'review' ? 'var(--primary-color)' : 'transparent',
              color: step === 'review' ? 'white' : 'var(--primary-color)',
              border: step === 'review' ? 'none' : '1px solid var(--primary-color)',
              borderRadius: '4px',
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            {t('guided.buttons.next', { step: ['Info', 'Fields', 'Review'][progressStep] })}
          </button>
        )}
      </div>

      {/* FR-4.4: ARIA labels and semantic structure for accessibility */}
      <nav aria-label={t('guided.buttons.progressLabel')} style={{ marginTop: '24px' }}>
        <ol start={progressStep} style={{ listStyle: 'none', padding: 0, display: 'flex', gap: '16px' }}>
          <li style={{ color: progressStep === 1 ? 'var(--primary-color)' : 'var(--text-muted)' }}>{t('guided.buttons.step0')}</li>
          <li style={{ color: progressStep === 2 ? 'var(--primary-color)' : 'var(--text-muted)' }}>{t('guided.buttons.step1')}</li>
          <li style={{ color: progressStep === 3 ? 'var(--primary-color)' : 'var(--text-muted)' }}>{t('guided.buttons.step2')}</li>
        </ol>
      </nav>
    </div>
  );
}