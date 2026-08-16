/**
 * No `'use client'`: its only importer, `ToolRunner`, already declares the
 * boundary. Everything here is a keystroke or a click and all of it still works —
 * a module imported by a client module is client code — but the directive itself
 * was buying nothing and costing the architecture ratchet.
 */

/**
 * The document half of the diagnostic runner.
 *
 * `ToolRunner` scores NUMBERS the person picked from choices we wrote — sliders and
 * radio scales, where "have they finished" is a count of answered questions. An
 * analyzer scores PROSE they wrote themselves, so the form is a paste area, the
 * completeness rule is "are the required documents non-empty", and the endpoint is
 * `/analyze` rather than `/compute`.
 *
 * Those are the only differences, which is why this renders the SAME
 * `ToolResultView` and is reached through `ToolRunner` rather than beside it: no
 * caller — the reference page, a canvas object — should have to know which kind of
 * tool it asked for.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { toolsApi } from '@/lib/builderforceApi';
import { ToolResultView } from '@/components/tools/ToolResultView';
import { trackToolRun } from '@/lib/marketingApi';
import { documentsComplete, type ToolDefinition, type ToolResult } from '@/lib/tools';
import { getStoredUser } from '@/lib/auth';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 18,
};
const fieldBase: React.CSSProperties = {
  padding: '9px 12px', fontSize: 'var(--font-size-body)', background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', width: '100%', fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  padding: '10px 20px', fontSize: 'var(--font-size-body)', fontWeight: 700,
  borderRadius: 'var(--radius-lg)', border: 'none',
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: 'var(--text-on-accent)', cursor: 'pointer',
};

export interface AnalyzerRunnerProps {
  definition: ToolDefinition & { kind: 'analyzer' };
  /** Canvas objects need React Flow's escape hatch so typing does not pan the board. */
  embedded?: boolean;
  initialValues?: Record<string, string>;
  onRunComplete?: (values: Record<string, string>, result: ToolResult) => void;
}

export function AnalyzerRunner({ definition, embedded = false, initialValues, onRunComplete }: AnalyzerRunnerProps) {
  const t = useTranslations('tools');
  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // A select with no chosen value must still POST its first option, or the server
  // reads an empty string and silently analyses the wrong variant.
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const field of definition.fields) {
      if (field.type === 'select' && field.options?.length && values[field.id] === undefined) {
        seeded[field.id] = field.options[0]!.value;
      }
    }
    if (Object.keys(seeded).length) setValues((prev) => ({ ...seeded, ...prev }));
    // Seeding is keyed by the definition alone; `values` is deliberately out so
    // clearing a select by hand is not immediately undone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition]);

  const setField = (id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setResult(null);
  };

  const isAuthed = !!getStoredUser();

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await toolsApi.analyze(definition.id, values);
      setResult(res);
      onRunComplete?.(values, res);
      // Anonymous runs are marketing leads, exactly as the scored tools treat them.
      // The DOCUMENTS never travel with it — only the tool id and the result.
      if (!isAuthed) trackToolRun(definition.id, {}, res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('runFailed'));
    } finally {
      setRunning(false);
    }
  };

  const canRun = documentsComplete(definition, values);

  return (
    <div className={embedded ? 'nodrag nowheel' : undefined}>
      {embedded && (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--canvas-ink-soft)', margin: '0 0 14px' }}>
          {definition.about}
        </p>
      )}

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {definition.fields.map((field) => (
          <label key={field.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-strong)' }}>
              {field.label}
              {!field.required && (
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {t('analyzer.optional')}</span>
              )}
            </span>

            {field.type === 'document' && (
              <textarea
                value={values[field.id] ?? ''}
                onChange={(e) => setField(field.id, e.target.value)}
                placeholder={field.placeholder}
                rows={embedded ? 5 : 9}
                style={{ ...fieldBase, resize: 'vertical', lineHeight: 1.55 }}
              />
            )}

            {field.type === 'line' && (
              <input
                type="text"
                value={values[field.id] ?? ''}
                onChange={(e) => setField(field.id, e.target.value)}
                placeholder={field.placeholder}
                style={fieldBase}
              />
            )}

            {field.type === 'select' && (
              <Select value={values[field.id] ?? ''} onChange={(e) => setField(field.id, e.target.value)}>
                {(field.options ?? []).map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    // A native <option> needs its own opaque colours or it is
                    // unreadable in one of the two themes.
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                  >
                    {option.label}
                  </option>
                ))}
              </Select>
            )}

            {field.help && (
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{field.help}</span>
            )}
          </label>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={run} disabled={!canRun || running} style={{ ...btnPrimary, opacity: canRun && !running ? 1 : 0.55 }}>
            {running ? t('analyzer.running') : t('analyzer.run')}
          </button>
          {!canRun && (
            <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('analyzer.needsRequired')}</span>
          )}
        </div>

        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>
          {t('analyzer.privacy')}
        </p>
      </div>

      {error && (
        <div role="alert" style={{ ...card, marginTop: 16, color: 'var(--coral-bright)' }}>{error}</div>
      )}

      {result && (
        <div style={{ marginTop: 20 }}>
          <ToolResultView result={result} />
        </div>
      )}
    </div>
  );
}
