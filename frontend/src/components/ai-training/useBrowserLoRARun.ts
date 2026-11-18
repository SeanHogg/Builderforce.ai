import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { createBrowserLoRATrainer, type BrowserLoRATrainerOptions, type BrowserLoRATraining } from '@/lib/training/browserLoRATrainer';
import type { TrainingDevice, TrainingParams, TrainingProgress } from '@/lib/training/protocol';

/** Progress is shown live in a status line; the log gets a line at most this often. */
const PROGRESS_LOG_INTERVAL_MS = 5000;

type RunOptions = Omit<BrowserLoRATrainerOptions, 'onReady' | 'onProgress' | 'workerFactory'>;

/**
 * The panel's handle on browser LoRA training: owns the trainer for one run at
 * a time, disposes it on unmount, and turns worker progress into a localized
 * status line plus an occasional log line. `device` is what the training
 * worker actually acquired (null until a run has started one).
 */
export function useBrowserLoRARun() {
  const t = useTranslations('aiTraining');
  const fmt = useFormat();
  const trainerRef = useRef<BrowserLoRATraining | null>(null);
  const lastLogAt = useRef(0);
  const [device, setDevice] = useState<TrainingDevice | null>(null);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);

  useEffect(() => () => {
    trainerRef.current?.dispose();
    trainerRef.current = null;
  }, []);

  const describe = useCallback((p: TrainingProgress) => t('trainingProgressStatus', {
    step: p.step,
    loss: p.loss.toFixed(4),
    tokensPerSecond: fmt.number(Math.round(p.tokensPerSecond)),
  }), [t, fmt]);

  const run = useCallback(async (options: RunOptions, params: TrainingParams, examples: string[]) => {
    setProgress(null);
    lastLogAt.current = 0;
    const trainer = createBrowserLoRATrainer({
      ...options,
      onReady: (acquired) => setDevice(acquired),
      onProgress: (p) => {
        setProgress(p);
        const now = Date.now();
        if (now - lastLogAt.current < PROGRESS_LOG_INTERVAL_MS) return;
        lastLogAt.current = now;
        options.onLog(describe(p));
      },
    });
    trainerRef.current = trainer;
    try {
      await trainer.init();
      await trainer.train(params, examples);
    } finally {
      // Only clear the slot if a newer run has not taken it.
      if (trainerRef.current === trainer) trainerRef.current = null;
      setProgress(null);
    }
  }, [describe]);

  const cancel = useCallback(() => trainerRef.current?.cancel(), []);

  return { run, cancel, device, status: progress ? describe(progress) : null };
}
