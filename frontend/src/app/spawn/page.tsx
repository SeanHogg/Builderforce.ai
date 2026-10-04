import { SpawnHero } from '@/components/spawn/SpawnHero';
import { SpawnCompare, SpawnDownload, SpawnFaq, SpawnFeatures, SpawnHowItWorks, SpawnSafety } from '@/components/spawn/SpawnSections';
import { SpawnPricing } from '@/components/spawn/SpawnPricing';
import styles from '@/components/spawn/spawn.module.css';

export const runtime = 'edge';

/** Spawn's landing page — what it is, how it works, why it is safe, what it costs, where to get it. */
export default function SpawnPage() {
  return (
    <main className={styles.main}>
      <SpawnHero />
      <SpawnHowItWorks />
      <SpawnFeatures />
      <SpawnCompare />
      <SpawnSafety />
      <SpawnPricing />
      <SpawnDownload />
      <SpawnFaq />
    </main>
  );
}
