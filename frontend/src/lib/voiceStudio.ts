'use client';

/**
 * useVoiceStudio — the Voice modality's state + actions, lifted out of the old
 * standalone VoiceClonePanel so the IDE chrome can drive it: the Brain writes the
 * lines (left), the green Run button calls `synth()`, the center shows the output,
 * and the right panel hosts the clone/config UI.
 *
 * It prefers the FREE on-device WebGPU path: when the studio engine loads it
 * enrols a speaker embedding client-side and synthesis runs locally ($0); when it
 * can't, the same `narrate()` seam routes to the metered server. Synthesis
 * unavailability surfaces the honest reason (Voice PRD §7), never a silent swap.
 *
 * The hook is always called (React hook rules) but no-ops unless `enabled`, so the
 * IDE can mount it for every project and only pay the clone-list/engine probes for
 * Voice projects.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createVoiceClone,
  deleteVoiceClone,
  listVoiceClones,
  type VoiceClone,
} from '@/lib/voiceClones';
import { decodeToPcm, type PcmAudio } from '@/lib/captureAudio';
import {
  deleteEmbedding,
  getOnDeviceEngine,
  loadEmbedding,
  narrate,
  narrationResultToObjectUrl,
  saveEmbedding,
  type NarrationResult,
  type SpeakerEmbedding,
} from '@/lib/voiceEngine';
import { fetchIdeProjectByStorage } from '@/lib/api';

export interface CreateCloneInput {
  name: string;
  consentAttested: boolean;
  reference: File | null;
  recordedPcm: PcmAudio | null;
}

export interface VoiceStudio {
  enabled: boolean;
  /** null while probing; true = free on-device engine, false = metered server. */
  onDevice: boolean | null;
  clones: VoiceClone[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  selectedCloneId: number;
  setSelectedCloneId: (id: number) => void;
  /** The lines to synthesize — editable in the panel, settable by the Brain. */
  text: string;
  setText: (t: string) => void;
  busy: boolean;
  /** Honest "synthesis unavailable" reason, never a silent swap. */
  unavailable: string | null;
  result: NarrationResult | null;
  audioUrl: string | null;
  /** Generate speech for the selected clone — wired to the green Run button. */
  synth: () => Promise<void>;
  createClone: (input: CreateCloneInput) => Promise<void>;
  deleteClone: (id: number) => Promise<void>;
  /** Whether a local speaker embedding (the free synthesis identity) is held. */
  hasEmbedding: (id: number) => boolean;
}

export function useVoiceStudio(
  { enabled, storageProjectId }: { enabled: boolean; storageProjectId: number },
): VoiceStudio {
  const [ideProjectId, setIdeProjectId] = useState<number | undefined>(undefined);
  const [onDevice, setOnDevice] = useState<boolean | null>(null);
  const [clones, setClones] = useState<VoiceClone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCloneId, setSelectedCloneId] = useState<number>(0);
  const [text, setText] = useState('The AI wrote this, and it speaks in my voice.');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [result, setResult] = useState<NarrationResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Resolve the IDE project backing this storage project so clones scope to this
  // project's own custom voices. Falls back to the unscoped (tenant) studio.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchIdeProjectByStorage(storageProjectId)
      .then((ip) => { if (!cancelled) setIdeProjectId(ip.id); })
      .catch(() => { /* fall back to unscoped studio */ });
    return () => { cancelled = true; };
  }, [enabled, storageProjectId]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listVoiceClones(ideProjectId);
      setClones(list);
      // Keep the selection valid: default to the first clone after a (re)load.
      setSelectedCloneId((cur) => (list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voice clones.');
    } finally {
      setLoading(false);
    }
  }, [enabled, ideProjectId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!enabled) return;
    void getOnDeviceEngine().then((e) => setOnDevice(Boolean(e)));
  }, [enabled]);

  // Revoke the previous object URL whenever it is replaced or on unmount.
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const synth = useCallback(async () => {
    if (!selectedCloneId) return;
    setBusy(true);
    setUnavailable(null);
    setResult(null);
    setAudioUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    try {
      // Prefer the on-device path when we hold a local embedding for this voice.
      const speaker = loadEmbedding(selectedCloneId);
      const res = await narrate(selectedCloneId, text, speaker);
      setResult(res);
      setAudioUrl(await narrationResultToObjectUrl(res));
    } catch (e) {
      setUnavailable(e instanceof Error ? e.message : 'Synthesis failed.');
    } finally {
      setBusy(false);
    }
  }, [selectedCloneId, text]);

  const createClone = useCallback(async (input: CreateCloneInput) => {
    // Enrol on-device when possible → embedding (the free synthesis identity).
    let embedding: SpeakerEmbedding | null = null;
    if (onDevice === true) {
      const engine = await getOnDeviceEngine();
      const pcm = input.recordedPcm ?? (input.reference ? await decodeToPcm(input.reference) : null);
      if (engine && pcm) embedding = engine.enroll(pcm);
    }
    const created = await createVoiceClone({
      name: input.name.trim(),
      consentAttested: input.consentAttested,
      reference: input.reference,
      embedding: embedding?.data ?? null,
      ideProjectId: ideProjectId ?? null,
    });
    if (embedding) saveEmbedding(created.id, embedding);
    await reload();
    setSelectedCloneId(created.id);
  }, [onDevice, ideProjectId, reload]);

  const deleteClone = useCallback(async (id: number) => {
    await deleteVoiceClone(id);
    deleteEmbedding(id);
    await reload();
  }, [reload]);

  const hasEmbedding = useCallback((id: number) => Boolean(loadEmbedding(id)), []);

  return {
    enabled,
    onDevice,
    clones,
    loading,
    error,
    reload,
    selectedCloneId,
    setSelectedCloneId,
    text,
    setText,
    busy,
    unavailable,
    result,
    audioUrl,
    synth,
    createClone,
    deleteClone,
    hasEmbedding,
  };
}
