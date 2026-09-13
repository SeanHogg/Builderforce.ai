import { useEffect, useState } from 'react';
import { SRGBColorSpace, TextureLoader, type Texture } from 'three';

/**
 * A person's profile picture as a texture for their figure's face — or null.
 *
 * ── WHY NOT drei's `useTexture` ──────────────────────────────────────────────
 * `useTexture` suspends while loading and THROWS when the load fails, and a
 * profile picture is an external URL we do not control: a Google or GitHub link
 * that expired, or a host that does not send CORS headers (WebGL may only sample
 * a cross-origin image the host allowed). One bad picture would take the whole
 * room down with it. Here a failed load is simply no texture, and the figure
 * keeps the plain face it always had — the name plate still shows the picture,
 * because an `<img>` needs no CORS.
 */
export function useFaceTexture(url: string | null | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return undefined;
    }
    let cancelled = false;
    let loaded: Texture | null = null;
    const loader = new TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (next) => {
        next.colorSpace = SRGBColorSpace;
        loaded = next;
        if (cancelled) next.dispose();
        else setTexture(next);
      },
      undefined,
      () => { if (!cancelled) setTexture(null); },
    );
    return () => {
      cancelled = true;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url]);

  return texture;
}
