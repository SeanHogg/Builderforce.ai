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
 * ── WHY THE STATE REMEMBERS WHICH URL IT IS FOR ──────────────────────────────
 * The obvious shape — clear the texture at the top of the effect, then load —
 * needs a synchronous `setState` inside the effect body, which costs a second
 * render pass on every URL change and is the exact pattern the hooks ratchet is
 * there to stop. Storing the URL alongside the texture removes the need: a
 * texture only counts while it is the one for the URL being asked about, so a
 * stale image is unrepresentable rather than cleared after the fact. State is
 * written from the loader's own callbacks and nowhere else.
 *
 * `crossOrigin: anonymous` is set because a texture drawn from an image the
 * browser fetched without CORS taints the context; a host that does not allow
 * it fails the load, which is the degradation path above rather than a silent
 * black square.
 */
export function useImageTexture(url: string | undefined): Texture | null {
  const [loaded, setLoaded] = useState<{ url: string; texture: Texture } | null>(null);

  useEffect(() => {
    if (!url) return;
    let live = true;
    let owned: Texture | null = null;
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
        owned = result;
        setLoaded({ url, texture: result });
      },
      undefined,
      () => { if (live) setLoaded(null); },
    );
    return () => {
      live = false;
      owned?.dispose();
    };
  }, [url]);

  return loaded && loaded.url === url ? loaded.texture : null;
}
