/**
 * Rovr's mount of the shared translation wiring (PRD 42 · Part E): the panel's on-device
 * tasks, the cloud fallback ONLY under Hybrid / Specific while signed in (Local only and a
 * signed-out panel never send text anywhere), the browser's UI language and the panel's copy.
 */
import { useMemo, type ReactNode } from 'react';
import { TranslationProvider, createCloudTranslate } from '@seanhogg/builderforce-brain-ui';
import { useInferenceModeState, useServices, useSignedIn } from './hooks';
import { rovrTranslationLabels } from './labels/translationLabels';

export function RovrTranslationProvider({ children, onOpenModelPicker }: { children: ReactNode; onOpenModelPicker?: () => void }) {
  const services = useServices();
  const signedIn = useSignedIn();
  const mode = useInferenceModeState();
  const cloudTranslate = useMemo(
    () => createCloudTranslate((body) => services.api.request<{ translations: string[] }>('/api/translate', { method: 'POST', json: body })),
    [services],
  );
  const cloud = signedIn && mode.loaded && mode.mode !== 'local-only' ? cloudTranslate : null;
  const labels = useMemo(() => rovrTranslationLabels(), []);
  return (
    <TranslationProvider
      tasks={services.onDeviceTasks}
      cloud={cloud}
      locale={chrome.i18n.getUILanguage()}
      labels={labels}
      identity={signedIn ? 'signed-in' : null}
      {...(onOpenModelPicker ? { openModelPicker: onOpenModelPicker } : {})}
    >
      {children}
    </TranslationProvider>
  );
}
