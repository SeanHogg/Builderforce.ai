/**
 * The editor webview's mount of the shared translation wiring (PRD 42 · Part E).
 *
 * The extension HOST's task port answers null for translate / detectLanguage, so the
 * webview supplies its own (`webviewOnDeviceTasks` — this Chromium page's built-in APIs and
 * page engines, nothing sent anywhere) and the cloud route is the fallback ONLY where the
 * mode allows it: Hybrid / Specific while signed in. Local only, signed out, or a mode the
 * host has not reported ⇒ no cloud, and text stays as written. The call rides the webview's
 * own authenticated API request (`authedFetch`), the same one the chat's other reads use.
 */
import { useMemo, type ReactNode } from 'react';
import { TranslationProvider, createCloudTranslate, translationLabelsFrom, bundleLookup } from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from '../authedFetch';
import { webviewOnDeviceTasks } from '../webviewOnDeviceTasks';
import { getToken, post, refreshToken, type InitData } from '../vscodeBridge';
import { useViewerId } from './useViewerId';
import { translationIdentityOf } from './translationIdentity';

/** Module-level so the provider's value stays referentially stable across renders. */
const openModelPicker = () => post('downloadLocalModel');

export function VsCodeTranslationProvider({ init, children }: { init: InitData; children: ReactNode }) {
  const mayUseCloud = init.signedIn && !!init.inferenceMode && init.inferenceMode !== 'local-only';
  const cloud = useMemo(() => {
    if (!mayUseCloud) return null;
    const request = authedFetch(init.baseUrl, getToken, refreshToken);
    return createCloudTranslate((body) => request<{ translations: string[] }>('/api/translate', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
  }, [mayUseCloud, init.baseUrl]);
  const viewerId = useViewerId();
  const tasks = useMemo(() => webviewOnDeviceTasks(), []);
  const labels = useMemo(() => translationLabelsFrom(bundleLookup(init.labels, (key) => key)), [init.labels]);
  return (
    <TranslationProvider
      tasks={tasks}
      cloud={cloud}
      locale={init.locale ?? navigator.language}
      labels={labels}
      identity={translationIdentityOf(init.signedIn, viewerId)}
      openModelPicker={openModelPicker}
    >
      {children}
    </TranslationProvider>
  );
}
