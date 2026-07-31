'use client';

/**
 * InputModeForm — top-level container that orchestrates Guided vs Express mode.
 *
 * - Reads/writes the user's preferred mode to localStorage (FR-1).
 * - Renders GuidedInput or ExpressInput based on current mode.
 * - Preserves field values across mode switches so no data is lost (FR-1).
 * - Both modes submit the same payload through the same onSubmit callback,
 *   and both call the same success handler on completion (FR-4.2 / FR-4.3).
 */
import { useCallback, useState, useEffect } from 'react';
import { GuidedInput } from '@/components/GuidedInput';
import { ExpressInput } from '@/components/ExpressInput';
import {
  buildInitialValues,
  getStoredInputMode,
  setStoredInputMode,
  trackInputModeEvent,
  type FormSchema,
  type InputMode,
} from '@/lib/inputMode';

export interface InputModeFormProps {
  schema: FormSchema;
  /** Called with the final payload when the user submits through either mode. */
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  /** Called after successful submission — receives the parsed server response. */
  onSuccess?: (response: unknown) => void;
  /** Pre-populated values (e.g. from URL params / template). */
  initialValues?: Record<string, unknown>;
  className?: string;
}

export function InputModeForm({
  schema,
  onSubmit,
  onSuccess,
  initialValues,
  className,
}: InputModeFormProps) {
  const [mode, setMode] = useState<InputMode>(() => getStoredInputMode() ?? 'guided');
  const [values, setValues] = useState<Record<string, unknown>>(
    () => initialValues ?? buildInitialValues(schema),
  );

  // Sync mode to localStorage on change (FR-1)
  useEffect(() => {
    setStoredInputMode(mode);
  }, [mode]);

  // Track initial mode selection
  useEffect(() => {
    trackInputModeEvent({ event: 'mode_select', mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrappedSubmit = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await onSubmit(payload);
      onSuccess?.(response);
    },
    [onSubmit, onSuccess],
  );

  const switchToGuided = useCallback((currentValues: Record<string, unknown>) => {
    setValues(currentValues);
    setMode('guided');
  }, []);

  const switchToExpress = useCallback((currentValues: Record<string, unknown>) => {
    setValues(currentValues);
    setMode('express');
  }, []);

  return (
    <div className={className}>
      {mode === 'guided' ? (
        <GuidedInput
          schema={schema}
          onSubmit={wrappedSubmit}
          initialValues={values}
          onSwitchToExpress={switchToExpress}
        />
      ) : (
        <ExpressInput
          schema={schema}
          onSubmit={wrappedSubmit}
          initialValues={values}
          onSwitchToGuided={switchToGuided}
        />
      )}
    </div>
  );
}
