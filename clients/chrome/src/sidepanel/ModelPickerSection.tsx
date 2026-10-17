/**
 * Settings → Model: which model Rovr runs on. "Automatic" is local first with failover to
 * the gateway; any downloaded on-device model (WebGPU `bfi`, WebLLM — run inside this
 * side panel) can be pinned instead. The list is brain-ui's shared on-device list over
 * the panel's own model store — the same rows, states and actions as the `/` menu on the
 * web and in the editor — and the pin is persisted in Rovr settings, where the route
 * reads it per turn (`inference/route.ts`).
 */
import { useEffect, useMemo } from 'react';
import { LocalModelList, useLocalModels } from '@seanhogg/builderforce-brain-ui';
import { t } from '../i18n/t';
import { rovrLocalModelLabels } from './labels/localModelLabels';
import { usePinnedModel, useServices } from './hooks';

export function ModelPickerSection() {
  const services = useServices();
  const labels = useMemo(rovrLocalModelLabels, []);
  const locale = useMemo(() => chrome.i18n.getUILanguage(), []);
  const local = useLocalModels(services.pageEngines.store);
  // The ONE pin — the composer's `/` Model tab reads and sets the same one.
  const [pinned, choose] = usePinnedModel();

  // A pinned model that was removed (or no longer fits this device) cannot serve a turn;
  // fall back to automatic rather than leave a pin every turn would fail on.
  const pinnedRow = pinned ? local.rows?.find((row) => row.ref === pinned) : undefined;
  useEffect(() => {
    if (pinnedRow && (pinnedRow.state === 'absent' || pinnedRow.state === 'unsupported')) choose(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedRow?.state]);

  return (
    <div className="rovr-card rovr-stack">
      <h2 className="rovr-h2">{t('modelHeading')}</h2>
      <p className="rovr-muted">{t('modelIntro')}</p>
      <button
        type="button"
        className={`rovr-btn${pinned ? '' : ' rovr-btn--primary'}`}
        aria-pressed={!pinned}
        onClick={() => choose(null)}
      >
        {t('modelAuto')} · <span>{t('modelAutoHint')}</span>
      </button>
      <LocalModelList
        state={local}
        labels={labels}
        locale={locale}
        {...(pinned ? { activeRef: pinned } : {})}
        onSelect={choose}
      />
    </div>
  );
}
