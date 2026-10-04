import { useEffect, useState } from 'react';
import type { ChatModelSelection } from '@/components/ChatInput';
import type { BrainEffort } from '@/lib/brain';
import { accountBrainPreferencesApi } from '@/lib/accountBrainPreferencesApi';

/**
 * Composer run-shaping toggles (the `/` menu + the `+` menu's web option) —
 * compiled into the ambient system context so each actually changes the next
 * turn. Mirrors the VS Code Brain composer.
 */
export function useBrainAccountPreferences() {
  const [effort, setEffort] = useState<BrainEffort>('balanced');
  const [thinking, setThinking] = useState(false);
  const [webBrowsing, setWebBrowsing] = useState(false);
  const [modelSelection, setModelSelection] = useState<ChatModelSelection>({ mode: 'auto' });
  const [responseInstructions, setResponseInstructions] = useState('');
  const [accountPreferencesReady, setAccountPreferencesReady] = useState(false);
  // Account preferences use the person-level credential and therefore follow the
  // user across tenants, projects, chats, browsers and devices. Workspace roles do
  // not gate a human's authority over their own defaults.
  useEffect(() => {
    let live = true;
    accountBrainPreferencesApi.get()
      .then(({ preferences }) => {
        if (!live) return;
        setEffort(preferences.effort);
        setThinking(preferences.thinking);
        setWebBrowsing(preferences.webBrowsing);
        setModelSelection(preferences.modelSelection);
        setResponseInstructions(preferences.responseInstructions);
      })
      .catch(() => { /* signed-out/embed surfaces keep safe defaults */ })
      .finally(() => { if (live) setAccountPreferencesReady(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!accountPreferencesReady) return;
    const timer = window.setTimeout(() => {
      void accountBrainPreferencesApi.update({ effort, thinking, webBrowsing, modelSelection, responseInstructions })
        .catch(() => { /* the global API error surface reports save failures */ });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [accountPreferencesReady, effort, thinking, webBrowsing, modelSelection, responseInstructions]);

  return {
    effort,
    setEffort,
    thinking,
    setThinking,
    webBrowsing,
    setWebBrowsing,
    modelSelection,
    setModelSelection,
    responseInstructions,
  };
}
