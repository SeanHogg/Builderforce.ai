'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { empInsightsApi, DELAY_REASON_CODES, type DelayReasonCode } from '@/lib/empInsightsApi';

/**
 * DelayReasonTag (EMP-9) — a per-task control to record WHY a task is late from the
 * fixed delay taxonomy. Writes go straight to the delay-taxonomy endpoint (a task's
 * delay reason lives in its own table, not on the task row), so this component owns
 * its own persistence. `value` is the currently-tagged reason (or null); `onChange`
 * lets the parent refresh any local mirror after a successful write.
 */
export function DelayReasonTag({
  taskId,
  value,
  onChange,
  disabled,
  style,
}: {
  taskId: number;
  value: DelayReasonCode | null;
  onChange?: (reason: DelayReasonCode | null) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const t = useTranslations('insights.emp');
  const [saving, setSaving] = useState(false);

  const set = async (raw: string) => {
    setSaving(true);
    try {
      if (!raw) {
        await empInsightsApi.clearDelay(taskId);
        onChange?.(null);
      } else {
        const reason = raw as DelayReasonCode;
        await empInsightsApi.tagDelay(taskId, reason);
        onChange?.(reason);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select
      disabled={disabled || saving}
      value={value ?? ''}
      onChange={(e) => set(e.target.value)}
      aria-label={t('delay.tagLabel')}
      style={style}
    >
      <option value="">{t('delay.untagged')}</option>
      {DELAY_REASON_CODES.map((code) => (
        <option key={code} value={code}>{t(`delay.reason.${code}`)}</option>
      ))}
    </Select>
  );
}
