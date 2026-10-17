/**
 * Settings → Model: which model Rovr runs on. "Automatic" is local first with failover to
 * the gateway; any downloaded on-device model (WebGPU `bfi`, WebLLM — run inside this
 * side panel) can be pinned instead. The list is brain-ui's shared on-device list over
 * the panel's own model store — the same rows, states and actions as the `/` menu on the
 * web and in the editor — and the pin is persisted in Rovr settings, where the route
 * reads it per turn (`inference/route.ts`).
 */
import { useEffect, useMemo } from 'react';
import { LocalModelList, useLocalModels, type LocalModelLabels } from '@seanhogg/builderforce-brain-ui';
import { t } from '../i18n/t';
import { usePinnedModel, useServices } from './hooks';

/** The shared list's copy, from Rovr's catalogs (`cancel` / `remove` are Rovr's own) —
 *  also the on-device half of the composer's `/` Model tab (`labels/composerLabels.ts`). */
export function rovrLocalModelLabels(): LocalModelLabels {
  return {
    localCatalogHeading: t('lmCatalogHeading'),
    localDownload: t('lmDownload'),
    localDownloading: t('lmDownloading'),
    localCancel: t('cancel'),
    localRemove: t('remove'),
    localMoreActions: t('lmMoreActions'),
    localTools: t('lmTools'),
    localContext: t('lmContext'),
    localDownloadFailed: t('lmDownloadFailed'),
    localReasonWebgpu: t('lmReasonWebgpu'),
    localReasonF16: t('lmReasonF16'),
    localReasonBuffer: t('lmReasonBuffer'),
    localReasonEngine: t('lmReasonEngine'),
  };
}

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
