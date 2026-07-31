'use client';

/**
 * GuidedInput — step-by-step form entry (FR-2).
 *
 * Renders one FieldGroup at a time with a progress bar, inline validation on
 * advance, back navigation, contextual help, and a final review step. Shares
 * the same FormSchema and submit pipeline as ExpressInput.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  buildInitialValues,
  markFormStart,
  trackInputModeEvent,
  validateGroup,
  type FieldDefinition,
  type FormSchema,
  type InputMode,
  type ValidationError,
} from '@/lib/inputMode';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GuidedInputProps {
  schema: FormSchema;
  /** Called with the final payload when the user confirms on the review step. */
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  /** Called when the user switches to Express mode (pass current values). */
  onSwitchToExpress?: (values: Record<string, unknown>) => void;
  /** Pre-populated values (e.g. from a prior Express session). */
  initialValues?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderFieldInput(
  field: FieldDefinition,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  error: ValidationError | null,
  onKeyDown?: (e: KeyboardEvent) => void,
): React.ReactNode {
  const id = `guided-field-${field.key}`;
  const stringVal = value != null ? String(value) : '';

  const sharedStyle: CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    borderRadius: 6,
    border: error ? '1.5px solid var(--coral, #ff6b6b)' : '1px solid var(--border)',
    background: 'var(--bg-input, #0c0f1a)',
    color: 'var(--text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
  };

  if (field.type === 'select' && field.options) {
    return (
      <select
        id={id}
        value={stringVal}
        onChange={(e) => onChange(field.key, e.target.value)}
        style={sharedStyle}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <option value="">-- Select --</option>
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        id={id}
        value={stringVal}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        rows={4}
        style={{ ...sharedStyle, resize: 'vertical' }}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    );
  }

  if (field.type === 'checkbox') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(field.key, e.target.checked)}
          style={{ width: 18, height: 18, accentColor: 'var(--coral, #ff6b6b)' }}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{field.label}</span>
      </label>
    );
  }

  return (
    <input
      id={id}
      type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'date' ? 'date' : 'text'}
      value={stringVal}
      onChange={(e) => onChange(field.key, e.target.value)}
      placeholder={field.placeholder}
      onKeyDown={onKeyDown}
      style={sharedStyle}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GuidedInput({
  schema,
  onSubmit,
  onSwitchToExpress,
  initialValues,
  className,
  style,
}: GuidedInputProps) {
  const [values, setValues] = useState<Record<string, unknown>>(
    () => initialValues ?? buildInitialValues(schema),
  );
  const [activeStep, setActiveStep] = useState(0);
  const [errors, setErrors] = useState<Map<string, ValidationError>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const startRef = useRef<number>(Date.now());

  const groups = schema.groups;
  const totalSteps = groups.length;
  const isLastContentStep = activeStep === totalSteps - 1 && !reviewMode;

  useEffect(() => {
    markFormStart();
    startRef.current = Date.now();
  }, []);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const validateCurrentStep = useCallback((): boolean => {
    const group = groups[activeStep];
    const stepErrors = validateGroup(group, values);
    const map = new Map<string, ValidationError>();
    for (const e of stepErrors) map.set(e.field, e);
    setErrors(map);
    return stepErrors.length === 0;
  }, [activeStep, groups, values]);

  const handleNext = useCallback(() => {
    if (!validateCurrentStep()) return;
    if (isLastContentStep) {
      // Move to review step
      setReviewMode(true);
      trackInputModeEvent({
        event: 'step_transition',
        mode: 'guided' as InputMode,
        step: 'review',
      });
    } else {
      setActiveStep((s) => s + 1);
      trackInputModeEvent({
        event: 'step_transition',
        mode: 'guided' as InputMode,
        step: groups[activeStep + 1]?.key ?? '',
      });
    }
  }, [validateCurrentStep, isLastContentStep, activeStep, groups]);

  const handleBack = useCallback(() => {
    if (reviewMode) {
      setReviewMode(false);
      return;
    }
    if (activeStep > 0) {
      setActiveStep((s) => s - 1);
    }
  }, [activeStep, reviewMode]);

  const handleStepClick = useCallback(
    (idx: number) => {
      // Allow jumping to any previously visited step; validate current before leaving
      if (idx < activeStep) {
        setActiveStep(idx);
        setReviewMode(false);
      }
    },
    [activeStep],
  );

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    trackInputModeEvent({
      event: 'submit',
      mode: 'guided' as InputMode,
      fieldCount: Object.values(values).filter((v) => v !== '' && v !== false).length,
      elapsedMs: Date.now() - startRef.current,
    });
    try {
      await onSubmit(values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [onSubmit, values]);

  const handleSwitch = useCallback(() => {
    trackInputModeEvent({ event: 'mode_switch', mode: 'express' as InputMode });
    onSwitchToExpress?.(values);
  }, [onSwitchToExpress, values]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !reviewMode) {
        e.preventDefault();
        handleNext();
      }
    },
    [handleNext, reviewMode],
  );

  // ---- Review step render ----
  if (reviewMode) {
    return (
      <div className={className} style={{ ...baseStyle, ...style }}>
        {/* Progress bar */}
        <div style={progressBarStyle}>
          {groups.map((g, i) => (
            <div
              key={g.key}
              style={{
                ...progressStepStyle,
                background: 'var(--coral, #ff6b6b)',
                color: '#fff',
              }}
            >
              {i + 1}
            </div>
          ))}
          <div
            style={{
              ...progressStepStyle,
              background: 'var(--coral, #ff6b6b)',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            ✓
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, display: 'block' }}>
          Step {totalSteps + 1} of {totalSteps + 1} — Review
        </span>

        <h2 style={headingStyle}>Review Your Entry</h2>

        {groups.map((group) => (
          <div key={group.key} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {group.title}
            </h3>
            {group.fields.map((field) => {
              const val = values[field.key];
              const display = field.type === 'checkbox'
                ? (val ? 'Yes' : 'No')
                : (val != null && String(val) !== '' ? String(val) : '—');
              return (
                <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>{field.label}</span>
                  <span style={{ color: 'var(--text-primary)', textAlign: 'right', marginLeft: 16 }}>
                    {display}
                    <button
                      type="button"
                      onClick={() => {
                        const stepIdx = groups.findIndex((g) => g.key === group.key);
                        if (stepIdx >= 0) { setActiveStep(stepIdx); setReviewMode(false); }
                      }}
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        color: 'var(--coral, #ff6b6b)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                      aria-label={`Edit ${field.label}`}
                    >
                      edit
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {submitError && (
          <div style={errorBannerStyle} role="alert">
            {submitError}
            <button type="button" onClick={handleSubmit} style={retryButtonStyle}>Retry</button>
          </div>
        )}

        <div style={navRowStyle}>
          <button type="button" onClick={handleBack} style={secondaryButtonStyle}>
            ← Back
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {onSwitchToExpress && (
              <button type="button" onClick={handleSwitch} style={secondaryButtonStyle}>
                Switch to Express
              </button>
            )}
            <button type="button" onClick={handleSubmit} disabled={submitting} style={primaryButtonStyle}>
              {submitting ? 'Submitting…' : 'Confirm & Submit'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step render ----
  const group = groups[activeStep];

  return (
    <div className={className} style={{ ...baseStyle, ...style }}>
      {/* Mode indicator */}
      <div style={modeIndicatorStyle}>
        <span style={{ fontWeight: 700, color: 'var(--coral, #ff6b6b)', fontSize: 12 }}>GUIDED</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Step-by-step</span>
        {onSwitchToExpress && (
          <button type="button" onClick={handleSwitch} style={switchLinkStyle}>
            Switch to Express
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div style={progressBarStyle} role="progressbar" aria-valuenow={activeStep + 1} aria-valuemin={1} aria-valuemax={totalSteps}>
        {groups.map((g, i) => (
          <button
            key={g.key}
            type="button"
            onClick={() => handleStepClick(i)}
            disabled={i > activeStep}
            aria-label={`Step ${i + 1}: ${g.title}${i <= activeStep ? '' : ' (locked)'}`}
            style={{
              ...progressStepStyle,
              background: i <= activeStep ? 'var(--coral, #ff6b6b)' : 'var(--border-subtle)',
              color: i <= activeStep ? '#fff' : 'var(--text-muted)',
              cursor: i < activeStep ? 'pointer' : i === activeStep ? 'default' : 'not-allowed',
              border: 'none',
              fontWeight: i === activeStep ? 700 : 400,
            }}
          >
            {i < activeStep ? '✓' : i + 1}
          </button>
        ))}
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, display: 'block' }}>
        Step {activeStep + 1} of {totalSteps} — {group.title}
      </span>

      {/* Step heading */}
      <h2 style={headingStyle}>{group.title}</h2>
      {group.description && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
          {group.description}
        </p>
      )}

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {group.fields.map((field) => {
          const err = errors.get(field.key) ?? null;
          return (
            <div key={field.key}>
              {field.type !== 'checkbox' && (
                <label
                  htmlFor={`guided-field-${field.key}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: 4,
                  }}
                >
                  {field.label}
                  {field.required && <span style={{ color: 'var(--coral, #ff6b6b)' }} aria-label="required">*</span>}
                  {field.help && (
                    <span
                      title={field.help}
                      tabIndex={0}
                      role="tooltip"
                      aria-label={field.help}
                      style={{
                        display: 'inline-flex',
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: 'var(--border-subtle)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        cursor: 'help',
                        marginLeft: 4,
                      }}
                    >
                      ?
                    </span>
                  )}
                </label>
              )}
              {renderFieldInput(field, values[field.key], handleChange, err, handleKeyDown)}
              {err && (
                <span id={`guided-field-${field.key}-error`} role="alert" style={{ color: 'var(--coral, #ff6b6b)', fontSize: 12, marginTop: 4, display: 'block' }}>
                  {err.message}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div style={navRowStyle}>
        <button
          type="button"
          onClick={handleBack}
          disabled={activeStep === 0}
          style={{
            ...secondaryButtonStyle,
            opacity: activeStep === 0 ? 0.5 : 1,
          }}
          aria-label="Go back to previous step"
        >
          ← Back
        </button>
        <button type="button" onClick={handleNext} style={primaryButtonStyle}>
          {isLastContentStep ? 'Review →' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles (kept with component to avoid extra CSS file for small module)
// ---------------------------------------------------------------------------

const baseStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '24px',
  background: 'var(--bg-deep, #050914)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  maxWidth: 680,
  width: '100%',
};

const headingStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--text-primary)',
  margin: '0 0 8px',
};

const progressBarStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 8,
};

const progressStepStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 600,
  transition: 'background 0.2s, color 0.2s',
};

const navRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 24,
  paddingTop: 16,
  borderTop: '1px solid var(--border-subtle)',
};

const primaryButtonStyle: CSSProperties = {
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'var(--coral, #ff6b6b)',
  color: '#fff',
};

const secondaryButtonStyle: CSSProperties = {
  padding: '10px 20px',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text-primary)',
};

const modeIndicatorStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: '1px solid var(--border-subtle)',
};

const switchLinkStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 12,
  color: 'var(--coral, #ff6b6b)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'underline',
};

const errorBannerStyle: CSSProperties = {
  background: 'rgba(255,107,107,0.1)',
  border: '1px solid var(--coral, #ff6b6b)',
  borderRadius: 8,
  padding: '12px 16px',
  color: 'var(--coral, #ff6b6b)',
  fontSize: 13,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 16,
};

const retryButtonStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--coral, #ff6b6b)',
  background: 'none',
  border: '1px solid var(--coral, #ff6b6b)',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
};
