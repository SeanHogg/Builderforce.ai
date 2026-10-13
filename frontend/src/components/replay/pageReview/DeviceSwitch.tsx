/** Desktop / phone (PRD 33 §5.2: every key page is captured at both sizes) — a tablist over the devices given. */

import { useTranslations } from 'next-intl';
import { REPLAY_CAPTURE_DEVICES, type ReplayCaptureDevice } from '@builderforce/interaction-contract';
import { Icon } from '@/components/ui/Icon';

const DEVICE_ICON = { desktop: 'monitor', phone: 'mobile' } as const;

export interface DeviceSwitchProps {
  value: ReplayCaptureDevice;
  onChange: (device: ReplayCaptureDevice) => void;
  devices?: readonly ReplayCaptureDevice[];
}

export function DeviceSwitch({ value, onChange, devices = REPLAY_CAPTURE_DEVICES }: DeviceSwitchProps) {
  const t = useTranslations('replay.page.device');
  return (
    <div role="tablist" aria-label={t('aria')} style={{ display: 'flex', gap: 'var(--space-1)' }}>
      {devices.map((device) => (
        <button
          key={device}
          type="button"
          role="tab"
          data-device={device}
          aria-selected={device === value}
          className={device === value ? 'btn-secondary' : 'btn-ghost'}
          style={{ minHeight: 44 }}
          onClick={() => onChange(device)}
        >
          <Icon name={DEVICE_ICON[device]} size={14} /> {t(device)}
        </button>
      ))}
    </div>
  );
}
