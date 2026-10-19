import type { Metadata } from 'next';
import { StageLearningClient } from './StageLearningClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: { absolute: 'Stage learning — Builderforce.ai' },
  description: 'Academy courses and the starter toolkit for your company business stage.',
  robots: { index: false, follow: true },
};

/** `/marketplace/stage-learning` — stage courses and toolkit install (epic #2545). */
export default function StageLearningPage() {
  return <StageLearningClient />;
}
