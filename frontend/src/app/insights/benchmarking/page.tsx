'use client';

import { LensPage } from '@/components/insights/LensShell';
import { BenchmarkingLens } from '@/components/insights/BenchmarkingLens';

export default function BenchmarkingInsightsPage() {
  return (
    <LensPage capability="insights.benchmarking" titleKey="benchmarking.title" subtitleKey="benchmarking.subtitle">
      <BenchmarkingLens />
    </LensPage>
  );
}
