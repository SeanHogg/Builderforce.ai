'use client';

/**
 * InputModeForm — top-level container that orchestrates Guided vs Express mode.
 *
 * - Reads/writes the user's preferred mode to localStorage (FR-1).
 * - Renders GuidedInput or ExpressInput based on current mode.
 * - Preserves field values across mode switches so no data is lost (FR-1).
 * - Both modes submit the same payload through the same onSubmit callback,
 *   and both call the same success handler on completion (FR-4.2 / FR-4.3).
 * - Includes a live region so screen readers announce mode transitions (FR-5).
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
  /**
   * Called with the final payload when the user submits through either mode.
   * Whatever it resolves with is treated as the server response and handed to
   * `onSuccess`, so both modes surface identical confirmation data (AC-10).
   */
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>;
  /**
   * Called after a successful submission with the resolved server response and
   * the submitted values. Both modes reach this with the same shape (FR-4.3).
   */
  onSuccess?: (response: unknown, values: Record<string, unknown>) => void;
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
  const [modeAnnouncement, setModeAnnouncement] = useState<string>('');

  // Sync mode to localStorage on change (FR-1)
  useEffect(() => {
    setStoredInputMode(mode);
  }, [mode]);

  // Announce mode changes for screen readers (FR-5)
  useEffect(() => {
    setModeAnnouncement(
      mode === 'guided'
        ? 'Switched to Guided mode — step-by-step entry.'
        : 'Switched to Express mode — single-screen entry.',
    );
  }, [mode]);

  // Track initial mode selection
  useEffect(() => {
    trackInputModeEvent({ event: 'mode_select', mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrappedSubmit = useCallback(
    async (payload: Record<string, unknown>) => {
      // FR-4.2 / FR-4.3: identical pipeline for both modes — the response the
      // submitter resolves with is forwarded verbatim so the confirmation screen
      // renders the same summary data regardless of mode (AC-9 / AC-10).
      const response = await onSubmit(payload);
      onSuccess?.(response, payload);
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
      {/* Screen-reader live region for mode transitions (FR-5) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {modeAnnouncement}
      </div>

      {/* Screen-reader live region for form state (error count, submit state) */}
      <div
        aria-live="assertive"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />

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
