/**
 * A page-review fix's rendered before → after inside THE fix card (PRD 33 §5.2):
 * the captures of the release the finding was read from (both devices) with the
 * patch's numbered callouts, the runner's after renders, and — for an SEO meta or
 * structured-data fix — the search result and JSON-LD diff. The page review hands
 * its captures in; anywhere else (the `fix` kind) they are read once through the
 * client (`pageReview`, single-flight).
 */

import { useEffect, useState } from 'react';
import {
  patchCallouts,
  REPLAY_CAPTURE_DEVICES,
  type ReplayCaptureDevice,
  type ReplayPageCaptureDto,
  type ReplayPrescriptionDto,
} from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { BeforeAfter, type BeforeAfterShot } from './BeforeAfter';
import { SerpPreview } from './SerpPreview';

export interface PrescriptionVisualProps {
  siteId: string;
  prescription: Pick<ReplayPrescriptionDto, 'visual' | 'captureId' | 'pagePath'>;
  /** The page's captures, when the caller already has them. */
  captures?: readonly ReplayPageCaptureDto[];
  device?: ReplayCaptureDevice;
}

/** The before/after shots of a fix: the captures of its release, per device. */
export function shotsFor(
  prescription: PrescriptionVisualProps['prescription'],
  captures: readonly ReplayPageCaptureDto[],
): Partial<Record<ReplayCaptureDevice, BeforeAfterShot>> {
  const visual = prescription.visual;
  if (!visual) return {};
  const release = captures.find((c) => c.id === prescription.captureId)?.releaseKey ?? captures[0]?.releaseKey ?? null;
  const out: Partial<Record<ReplayCaptureDevice, BeforeAfterShot>> = {};
  for (const device of REPLAY_CAPTURE_DEVICES) {
    const capture = captures.find((c) => c.releaseKey === release && c.deviceClass === device) ?? null;
    const afterPath = visual.afterScreenshotUrls[device] ?? null;
    if (!capture && !afterPath) continue;
    out[device] = { captureId: capture?.id ?? null, beforePath: capture?.foldScreenshotUrl ?? null, afterPath };
  }
  return out;
}

export function PrescriptionVisual({ siteId, prescription, captures, device }: PrescriptionVisualProps) {
  const visual = prescription.visual;
  const [read, setRead] = useState<readonly ReplayPageCaptureDto[]>([]);
  const needsRead = !!visual && !captures && !!prescription.pagePath && visual.patch.ops.length > 0;

  useEffect(() => {
    if (!needsRead || !prescription.pagePath) return undefined;
    let live = true;
    replayApi.pageReview(siteId, prescription.pagePath)
      .then((review) => { if (live) setRead(review.captures); })
      .catch(() => { if (live) setRead([]); });
    return () => { live = false; };
  }, [needsRead, siteId, prescription.pagePath]);

  if (!visual) return null;
  const shots = shotsFor(prescription, captures ?? read);
  const hasShots = Object.keys(shots).length > 0 && visual.patch.ops.length > 0;
  return (
    <>
      <SerpPreview visual={visual} />
      {hasShots && <BeforeAfter siteId={siteId} shots={shots} callouts={patchCallouts(visual.patch)} initialDevice={device} />}
    </>
  );
}
