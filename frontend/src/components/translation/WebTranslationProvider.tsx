import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useOptionalBrainContext, type OnDeviceTasks } from '@seanhogg/builderforce-brain-embedded';
import { TranslationProvider, translationLabelsFrom } from '@seanhogg/builderforce-brain-ui';
import { useWebInferenceMode } from '@/lib/localFirst/useWebInferenceMode';

type CloudTranslate = NonNullable<ComponentProps<typeof TranslationProvider>['cloud']>;

/** The cloud client loads on the first translation that needs it — never with the shell. */
const lazyCloudTranslate: CloudTranslate = async (texts, to, from) => (await import('@/lib/translateApi')).cloudTranslate(texts, to, from);

/**
 * Mounts the ONE translation wiring for the web app (PRD 42 · Part E): the browser's
 * on-device tasks, the cloud fallback ONLY where the mode allows it (Hybrid / Specific
 * AND signed in — Local only and anonymous visitors never send text anywhere), the
 * viewer's locale and the five-language copy.
 *
 * The on-device port is imported lazily: nothing about page engines belongs in the shell's
 * first paint, and a reader with nothing foreign on screen never builds it.
 */
export function WebTranslationProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const t = useTranslations('translation');
  const inference = useWebInferenceMode();
  const [tasks, setTasks] = useState<OnDeviceTasks | null>(null);
  useEffect(() => {
    let live = true;
    void import('@/lib/brain/onDeviceTasks').then((m) => { if (live) setTasks(m.browserOnDeviceTasks()); }, () => undefined);
    return () => { live = false; };
  }, []);
  const cloud = inference.signedIn && inference.value !== 'local-only' ? lazyCloudTranslate : null;
  const labels = useMemo(
    // `{language}` is the component's own token and stays literal.
    () => translationLabelsFrom((key) => t(key.slice('translation.'.length), { language: '{language}' })),
    [t],
  );
  // Outside a Brain thread (a canvas comment) the hint opens the Brain dock on its model menu.
  const brain = useOptionalBrainContext();
  const openModelPicker = useCallback(() => {
    void import('@/lib/brain/dockModelMenu').then((m) => { if (!m.requestDockModelMenu()) brain?.setOpen(true); });
  }, [brain]);
  return <TranslationProvider tasks={tasks} cloud={cloud} locale={locale} labels={labels} openModelPicker={openModelPicker} identity={inference.signedIn ? 'signed-in' : null}>{children}</TranslationProvider>;
}
