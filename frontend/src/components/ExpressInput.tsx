'use client';

/**
 * ExpressInput — single-screen bulk form entry (FR-3).
 *
 * Renders all fields on one scrollable screen, grouped by the same FieldGroup
 * sections used in Guided mode. Supports paste-to-fill, CSV/JSON file upload,
 * and consolidated error display on submit. Shares the same FormSchema and
 * submit pipeline as GuidedInput.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import {
  buildInitialValues,
  markFormStart,
  parseCsvUpload,
  parseDelimitedPaste,
  parseJsonUpload,
  trackInputModeEvent,
  validateAll,
  type FieldDefinition,
  type FormSchema,
  type InputMode,
  type PasteResult,
  type ValidationError,
} from '@/lib/inputMode';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExpressInputProps {
  schema: FormSchema;
  /** Called with the final payload on submit. */
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  /** Called when the user switches to Guided mode (pass current values). */
  onSwitchToGuided?: (values: Record<string, unknown>) => void;
  /** Pre-populated values (e.g. from URL params or a saved template, FR-3.6). */
  initialValues?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

function renderFieldInput(
  field: FieldDefinition,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  error: ValidationError | null,
): React.ReactNode {
  const id = `express-field-${field.key}`;
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
      style={sharedStyle}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExpressInput({
  schema,
  onSubmit,
  onSwitchToGuided,
  initialValues,
  className,
  style,
}: ExpressInputProps) {
  const [values, setValues] = useState<Record<string, unknown>>(
    () => initialValues ?? buildInitialValues(schema),
  );
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<PasteResult | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [uploadUnmapped, setUploadUnmapped] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const startRef = useRef<number>(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allFieldKeys = useMemo(
    () => new Set(schema.groups.flatMap((g) => g.fields.map((f) => f.key))),
    [schema],
  );

  useEffect(() => {
    markFormStart();
    startRef.current = Date.now();
  }, []);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ---- Paste-to-fill (FR-3.2) ----

  const handlePaste = useCallback(() => {
    const result = parseDelimitedPaste(pasteText, allFieldKeys);
    setPasteResult(result);
    if (Object.keys(result.values).length > 0) {
      setValues((prev) => ({ ...prev, ...result.values }));
      trackInputModeEvent({ event: 'paste_fill', mode: 'express' as InputMode });
    }
  }, [pasteText, allFieldKeys]);

  // ---- File upload (FR-3.3) ----

  const processFile = useCallback(
    (file: File) => {
      setUploadWarnings([]);
      setUploadUnmapped([]);
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        let result;
        if (file.name.endsWith('.json')) {
          result = parseJsonUpload(text, allFieldKeys);
        } else {
          result = parseCsvUpload(text, allFieldKeys);
        }
        setUploadWarnings(result.warnings);
        setUploadUnmapped(result.unmappedColumns);
        if (Object.keys(result.values).length > 0) {
          setValues((prev) => ({ ...prev, ...result.values }));
          trackInputModeEvent({ event: 'file_upload', mode: 'express' as InputMode });
        }
      };
      reader.readAsText(file);
    },
    [allFieldKeys],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  // ---- Validation & Submit (FR-3.4, FR-3.5) ----

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const allErrors = validateAll(schema, values);
      if (allErrors.length > 0) {
        setErrors(allErrors);
        // Focus first error field
        const first = allErrors[0];
        const el = document.getElementById(`express-field-${first.field}`);
        el?.focus();
        return;
      }
      setErrors([]);
      setSubmitting(true);
      setSubmitError(null);
      trackInputModeEvent({
        event: 'submit',
        mode: 'express' as InputMode,
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
    },
    [schema, values, onSubmit],
  );

  const handleSwitch = useCallback(() => {
    trackInputModeEvent({ event: 'mode_switch', mode: 'guided' as InputMode });
    onSwitchToGuided?.(values);
  }, [onSwitchToGuided, values]);

  const focusErrorField = useCallback((fieldKey: string) => {
    const el = document.getElementById(`express-field-${fieldKey}`);
    el?.focus();
  }, []);

  return (
    <div
      className={className}
      style={{ ...baseStyle, ...style }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Mode indicator */}
      <div style={modeIndicatorStyle}>
        <span style={{ fontWeight: 700, color: 'var(--coral, #ff6b6b)', fontSize: 12 }}>EXPRESS</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Single-screen entry</span>
        {onSwitchToGuided && (
          <button type="button" onClick={handleSwitch} style={switchLinkStyle}>
            Switch to Guided
          </button>
        )}
      </div>

      {/* Drag overlay */}
      {dragOver && (
        <div style={dragOverlayStyle} aria-live="polite">
          Drop CSV or JSON file to auto-fill
        </div>
      )}

      {/* Consolidated error summary (FR-3.5) */}
      {errors.length > 0 && (
        <div style={errorSummaryStyle} role="alert">
          <strong style={{ display: 'block', marginBottom: 8 }}>
            {errors.length} error{errors.length !== 1 ? 's' : ''} found:
          </strong>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {errors.map((err) => (
              <li key={err.field} style={{ marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => focusErrorField(err.field)}
                  style={errorLinkStyle}
                >
                  {err.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Submit error (network / server) */}
      {submitError && (
        <div style={errorBannerStyle} role="alert">
          {submitError}
          <button type="button" onClick={() => handleSubmit()} style={retryButtonStyle}>Retry</button>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Paste-to-fill toggle */}
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setShowPaste((s) => !s)}
            style={toolButtonStyle}
            aria-expanded={showPaste}
            aria-controls="express-paste-panel"
          >
            {showPaste ? '▲ Hide' : '▼'} Paste to Fill
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...toolButtonStyle, marginLeft: 8 }} aria-label="Upload CSV or JSON file">
            📄 Upload File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        </div>

        {/* Paste panel */}
        {showPaste && (
          <div id="express-paste-panel" style={pastePanelStyle}>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste key: value pairs, one per line, or a CSV header row + data row…"
              rows={5}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-input, #0c0f1a)',
                color: 'var(--text-primary)',
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'monospace',
              }}
            />
            <button type="button" onClick={handlePaste} style={{ ...primaryButtonStyle, marginTop: 8 }}>
              Apply Pasted Data
            </button>
            {pasteResult && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {Object.keys(pasteResult.values).length > 0 && (
                  <span style={{ color: 'var(--green, #4caf50)' }}>
                    ✓ Filled {Object.keys(pasteResult.values).length} field{Object.keys(pasteResult.values).length !== 1 ? 's' : ''}.{' '}
                  </span>
                )}
                {pasteResult.unmatched.length > 0 && (
                  <span style={{ color: 'var(--amber, #ffc107)' }}>
                    ⚠ Unmatched: {pasteResult.unmatched.join(', ')}
                  </span>
                )}
                {pasteResult.warnings.map((w, i) => (
                  <div key={i} style={{ color: 'var(--amber, #ffc107)', marginTop: 4 }}>{w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upload feedback */}
        {uploadWarnings.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--amber, #ffc107)', marginBottom: 12 }}>
            {uploadWarnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}
        {uploadUnmapped.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Unmapped columns: {uploadUnmapped.join(', ')}
          </div>
        )}

        {/* Field groups (same sections as Guided steps) */}
        {schema.groups.map((group) => (
          <fieldset key={group.key} style={groupStyle}>
            <legend style={legendStyle}>{group.title}</legend>
            {group.description && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                {group.description}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {group.fields.map((field) => {
                const err = errors.find((e) => e.field === field.key) ?? null;
                return (
                  <div key={field.key}>
                    {field.type !== 'checkbox' && (
                      <label
                        htmlFor={`express-field-${field.key}`}
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
                    {renderFieldInput(field, values[field.key], handleChange, err)}
                    {err && (
                      <span id={`express-field-${field.key}-error`} role="alert" style={{ color: 'var(--coral, #ff6b6b)', fontSize: 12, marginTop: 4, display: 'block' }}>
                        {err.message}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}

        {/* Submit row */}
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Press Enter to submit</span>
          <button type="submit" disabled={submitting} style={primaryButtonStyle}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const baseStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '24px',
  background: 'var(--bg-deep, #050914)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  maxWidth: 720,
  width: '100%',
  position: 'relative',
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

const toolButtonStyle: CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 6,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text-primary)',
};

const pastePanelStyle: CSSProperties = {
  marginBottom: 16,
  padding: 12,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-elevated)',
};

const groupStyle: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '16px',
  marginBottom: 16,
  marginInline: 0,
};

const legendStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
  padding: '0 8px',
};

const errorSummaryStyle: CSSProperties = {
  background: 'rgba(255,107,107,0.08)',
  border: '1px solid var(--coral, #ff6b6b)',
  borderRadius: 8,
  padding: '14px 18px',
  marginBottom: 16,
  fontSize: 13,
  color: 'var(--text-primary)',
};

const errorLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--coral, #ff6b6b)',
  cursor: 'pointer',
  fontSize: 13,
  textDecoration: 'underline',
  padding: 0,
  textAlign: 'left',
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
  marginBottom: 16,
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

const dragOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(255,107,107,0.12)',
  border: '2px dashed var(--coral, #ff6b6b)',
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--coral, #ff6b6b)',
  fontSize: 16,
  fontWeight: 600,
  zIndex: 10,
  pointerEvents: 'none',
};
