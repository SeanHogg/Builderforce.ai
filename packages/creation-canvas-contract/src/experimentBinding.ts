/**
 * Bind a canvas `experiment` card to a live A/B split.
 *
 * An experiment card's `variants` rows are authored until something measured
 * them. `measure.md` OUT-03 says an authored table is not a measured split,
 * and the Insights engine already counts live exposures and conversions on
 * `ab_test_variants`. This module is the rule that keeps the two apart: a
 * card is measured only when it names a real test key and every row carries
 * that test's own counts.
 *
 * Pure, and shared, so the card derive, the canvas act and a test that never
 * mounts React all refuse the same fake.
 */

export interface ExperimentVariantRow {
  variant: string;
  exposure: number;
  conversion: number;
  /** Relative lift against the control row, or null when it cannot be called. */
  lift: number | null;
}

export interface LiveExperimentSplit {
  /** `ab_tests.key`. */
  key: string;
  status: string;
  /** True while the engine refuses to call a winner (sample not reached). */
  underpowered: boolean;
  variants: readonly ExperimentVariantRow[];
}

export interface ExperimentBindingVerdict {
  measured: boolean;
  /** Why it is not a measurement, when `measured` is false. */
  reason: string | null;
}

const counted = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

/** One variant row, or null when the value is not a variant row at all. */
export function readExperimentVariantRow(raw: unknown): ExperimentVariantRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const variant = typeof row.variant === 'string' ? row.variant.trim() : '';
  const exposure = counted(row.exposure);
  const conversion = counted(row.conversion);
  if (!variant || exposure === null || conversion === null) return null;
  const lift = typeof row.lift === 'number' && Number.isFinite(row.lift) ? row.lift : null;
  return { variant, exposure, conversion, lift };
}

/**
 * A measured split, or a refusal.
 *
 * The key must be a real `ab_tests.key` (the caller looked it up). The rows
 * must be that lookup's counts. Passing the card's own authored table back
 * in is the forgery this exists to reject, so the caller must not do that.
 */
export function bindExperimentToLiveSplit(
  abTestKey: unknown,
  live: LiveExperimentSplit | null,
): { ok: true; split: LiveExperimentSplit } | { ok: false; reason: string } {
  const key = typeof abTestKey === 'string' ? abTestKey.trim().toLowerCase() : '';
  if (!key) return { ok: false, reason: 'no ab_tests key — an authored table is not a measured split' };
  if (!live) return { ok: false, reason: `no live split is registered under '${key}'` };
  if (live.key.trim().toLowerCase() !== key) {
    return { ok: false, reason: `live split key '${live.key}' does not match '${key}'` };
  }
  if (live.variants.length < 2) {
    return { ok: false, reason: 'a measured split needs a control and at least one variant' };
  }
  const exposures = live.variants.reduce((n, row) => n + row.exposure, 0);
  if (exposures < 1) {
    return { ok: false, reason: 'the live split has recorded no exposures yet' };
  }
  return { ok: true, split: { ...live, key } };
}

/**
 * The card-facing verdict. An authored table — rows with numbers and no live
 * split — is reported as not measured, which is the point of OUT-03.
 */
export function experimentMeasurementVerdict(
  abTestKey: unknown,
  live: LiveExperimentSplit | null,
): ExperimentBindingVerdict {
  const bound = bindExperimentToLiveSplit(abTestKey, live);
  if (!bound.ok) return { measured: false, reason: bound.reason };
  if (bound.split.underpowered) {
    return {
      measured: true,
      reason: 'bound to live traffic, but the declared minimum sample has not been reached',
    };
  }
  if (bound.split.status !== 'running' && bound.split.status !== 'concluded') {
    return { measured: true, reason: `bound to a ${bound.split.status} split; counts are the engine's, not authored` };
  }
  return { measured: true, reason: null };
}

/** The rows a bound card stores. Lift is relative to the first (control) row. */
export function measuredVariantRows(split: LiveExperimentSplit): ExperimentVariantRow[] {
  const control = split.variants[0];
  const controlRate = control && control.exposure > 0 ? control.conversion / control.exposure : null;
  return split.variants.map((row, index) => {
    if (index === 0 || controlRate === null || controlRate === 0 || row.exposure < 1) {
      return { ...row, lift: null };
    }
    return { ...row, lift: (row.conversion / row.exposure - controlRate) / controlRate };
  });
}
