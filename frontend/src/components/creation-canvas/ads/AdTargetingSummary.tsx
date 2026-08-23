'use client';

/**
 * An audience, in one line.
 *
 * A spec is six optional dimensions, and a row that shows the raw object shows nothing
 * useful; a row that shows nothing at all cannot tell an ad set aimed at under-25s in
 * Germany from one aimed at everyone on Earth — and those two spend the same budget very
 * differently. So every ad set says which it is, in words, before it is opened.
 *
 * "Everyone" is stated EXPLICITLY rather than left blank. An untargeted set is a real and
 * legitimate choice, and silence about it reads as "not loaded yet".
 *
 * Localized per dimension and joined with the locale's own list separator, so the
 * sentence is grammatical in each catalog rather than assembled from English commas.
 */

import { useTranslations } from 'next-intl';
import { isUntargeted, type AdTargeting } from '@/lib/adSetsApi';
import { useFormat } from '@/i18n/useFormat';

export interface AdTargetingSummaryProps {
  targeting: AdTargeting;
  /** The network's own spec, when it holds audiences this vocabulary cannot name. Shown
   *  as a caveat rather than ignored: reporting "everyone" for a set that is in fact
   *  tightly targeted in the network's console is the one wrong answer here. */
  nativeTargeting?: unknown;
}

/** True when the network reported a spec of its own that we did not fully understand. */
function hasNative(native: unknown): boolean {
  if (native == null) return false;
  if (Array.isArray(native)) return native.length > 0;
  return typeof native === 'object' ? Object.keys(native as object).length > 0 : Boolean(native);
}

export function AdTargetingSummary({ targeting, nativeTargeting }: AdTargetingSummaryProps) {
  const t = useTranslations('canvas.ads.targeting');
  const fmt = useFormat();

  const parts: string[] = [];
  if (targeting.countries?.length) parts.push(targeting.countries.join(' '));
  if (targeting.ageMin != null || targeting.ageMax != null) {
    parts.push(t('ageRange', {
      min: targeting.ageMin ?? t('anyAge'),
      max: targeting.ageMax ?? t('anyAge'),
    }));
  }
  if (targeting.genders?.length) parts.push(targeting.genders.map((g) => t(`gender.${g}`)).join(' / '));
  if (targeting.interests?.length) parts.push(targeting.interests.join(' · '));
  if (targeting.placements?.length) parts.push(targeting.placements.map((p) => t(`placement.${p}`)).join(' / '));
  if (targeting.devices?.length) parts.push(targeting.devices.map((d) => t(`device.${d}`)).join(' / '));

  if (isUntargeted(targeting)) {
    return <>{hasNative(nativeTargeting) ? t('nativeOnly') : t('everyone')}</>;
  }
  return <>{fmt.list(parts)}</>;
}
