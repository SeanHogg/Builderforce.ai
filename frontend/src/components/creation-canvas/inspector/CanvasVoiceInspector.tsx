import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { canvasProjectId } from '@/lib/canvasProjectRef';
import { useVoiceStudio } from '@/lib/voiceStudio';
import type { BrowserSpeechRecognition } from '../canvasBoardTypes';
import styles from '../CreationCanvas.module.css';
import { VoiceConfigPanel } from '../canvasLazyPanels';
import { VoiceOutput } from '@/components/builder/VoiceOutput';

export function CanvasVoiceInspector({ node, persistence, onChange }: { node: CreationFlowNode; persistence: 'local' | 'server'; onChange: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas');
  const storageProjectId = useMemo(() => canvasProjectId(node.data), [node.data]);
  const voice = useVoiceStudio({ enabled: persistence === 'server', storageProjectId });
  const loadedNode = useRef<string | null>(null);
  const savedResult = useRef<unknown>(null);

  useEffect(() => {
    if (loadedNode.current === node.id) return;
    loadedNode.current = node.id;
    voice.setText(typeof node.data.voiceScript === 'string' && node.data.voiceScript.trim() ? node.data.voiceScript : '');
  }, [node.data.voiceScript, node.id, voice.setText]);

  useEffect(() => {
    const savedCloneId = Number(node.data.voiceCloneId);
    if (Number.isInteger(savedCloneId) && savedCloneId > 0 && voice.clones.some((clone) => clone.id === savedCloneId) && voice.selectedCloneId !== savedCloneId) {
      voice.setSelectedCloneId(savedCloneId);
    }
  }, [node.data.voiceCloneId, voice.clones, voice.selectedCloneId, voice.setSelectedCloneId]);

  useEffect(() => {
    if (!voice.result || savedResult.current === voice.result) return;
    savedResult.current = voice.result;
    onChange({
      voiceScript: voice.text,
      voiceTranscript: voice.text,
      voiceCloneId: voice.selectedCloneId,
      voiceDurationMs: voice.result.durationMs,
      voiceEngine: voice.result.engineId,
      voiceAudioResource: voice.result.audioUrl ?? null,
      voiceWordTimestamps: voice.result.wordTimestamps,
      status: 'Generated',
      subtitle: voice.text,
    });
  }, [onChange, voice.result, voice.selectedCloneId, voice.text]);

  const dictate = () => {
    const browserWindow = window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) { onChange({ status: 'Voice dictation is not supported by this browser' }); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      voice.setText(transcript);
      onChange({ voiceScript: transcript, voiceTranscript: transcript, subtitle: transcript, status: 'Transcribed' });
    };
    recognition.onerror = () => onChange({ status: t('voiceTranscriptionFailed') });
    recognition.onend = null;
    recognition.start();
  };

  if (persistence === 'local') return <p className={styles.inspectorHint}>{t('voiceLocalHint')}</p>;
  return <div className={styles.canvasVoiceStudio}>
    <button type="button" className={styles.fullButton} onClick={dictate}>{t('dictateScript')}</button>
    <VoiceConfigPanel voice={voice} />
    <button type="button" className={styles.fullButton} disabled={voice.busy || !voice.selectedCloneId || !voice.text.trim()} onClick={() => { onChange({ voiceScript: voice.text, voiceTranscript: voice.text, status: t('generatingVoiceStatus') }); void voice.synth(); }}>{voice.busy ? t('generating') : t('generateVoice')}</button>
    <div className={styles.canvasVoiceOutput}><VoiceOutput result={voice.result} audioUrl={voice.audioUrl} busy={voice.busy} unavailable={voice.unavailable} /></div>
  </div>;
}
