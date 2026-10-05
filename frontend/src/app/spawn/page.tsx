import { SpawnHero } from '@/components/spawn/SpawnHero';
import { SpawnFaq, SpawnGetStarted, SpawnSafety, SpawnSteps } from '@/components/spawn/SpawnSections';
import { SpawnPricing } from '@/components/spawn/SpawnPricing';
import styles from '@/components/spawn/spawn.module.css';

export const runtime = 'edge';

/** Spawn's landing page — tap-first: the toy, three steps, the safety badges, the prices, the button. */
export default function SpawnPage() {
  return (
    <main className={styles.main}>
      <SpawnHero />
      <SpawnSteps />
      <SpawnSafety />
      <SpawnPricing />
      <SpawnFaq />
      <SpawnGetStarted />
    </main>
  );
}
