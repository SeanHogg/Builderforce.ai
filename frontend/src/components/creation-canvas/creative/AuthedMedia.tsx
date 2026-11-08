import type { ImgHTMLAttributes, VideoHTMLAttributes } from 'react';
import { useAuthedMediaUrl } from '@/lib/useAuthedMediaUrl';

/**
 * Media elements for canvas media and creation exports. A tenant-authenticated upload
 * (`/api/brain/uploads/<key>`) cannot be loaded by a bare `src` (no bearer token), so these go
 * through `useAuthedMediaUrl`; every other URL is rendered unchanged. While the blob is being
 * fetched, or when it was refused, nothing is rendered.
 */

type AuthedImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string };

export function AuthedImg({ src, onError, alt, ...rest }: AuthedImgProps) {
  const authed = useAuthedMediaUrl(src);
  if (!authed.url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- a blob/object URL, not an optimizable asset
  return <img {...rest} alt={alt ?? ''} src={authed.url} onError={onError} />;
}

type AuthedVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> & { src: string };

export function AuthedVideo({ src, ...rest }: AuthedVideoProps) {
  const authed = useAuthedMediaUrl(src);
  return authed.url ? <video {...rest} src={authed.url} /> : null;
}
