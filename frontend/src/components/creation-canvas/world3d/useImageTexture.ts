/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useEffect, useState } from 'react';
import { SRGBColorSpace, Texture, TextureLoader } from 'three';

/**
 * Load an image URL as a texture, or resolve to nothing.
 *
 * ── WHY NOT `useTexture` ─────────────────────────────────────────────────────
 * drei's loader suspends, and a suspending loader inside a live scene turns a
 * broken image URL into a thrown promise that never settles — the whole room
 * goes blank because one poster 404'd. Every URL a prop carries is authored by
 * a person or an agent, so "this one does not load" is a NORMAL outcome that
 * has to degrade to the prop's own colour rather than take the surface with it.
 *
 * The loader is therefore explicit, failure resolves to `null`, and the texture
 * is disposed when the URL changes or the component unmounts — a scene that
 * re-authors a wall a dozen times must not leak a dozen GPU textures.
 *
 * `crossOrigin: anonymous` is set because a texture drawn from an image the
 * browser fetched without CORS taints the context; a host that does not allow
 * it fails the load, which is the degradation path above rather than a silent
 * black square.
 */
export function useImageTexture(url: string | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }
    let live = true;
    let loaded: Texture | null = null;
    const loader = new TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (result) => {
        // sRGB, or every authored image renders washed out against the
        // scene's linear lighting — the classic "why is my photo grey".
        result.colorSpace = SRGBColorSpace;
        if (!live) {
          result.dispose();
          return;
        }
        loaded = result;
        setTexture(result);
      },
      undefined,
      () => { if (live) setTexture(null); },
    );
    return () => {
      live = false;
      setTexture(null);
      loaded?.dispose();
    };
  }, [url]);

  return texture;
}
