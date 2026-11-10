/**
 * WHO the device translation cache belongs to (`VsCodeTranslationProvider` → the shared
 * `TranslationProvider`'s `identity`): the signed-in viewer's id (the token's subject), null
 * when signed out. The provider clears the cache whenever a non-null identity changes, so
 * A → sign-out → B, or A switching straight to B, never serves A's translations to B.
 */
export function translationIdentityOf(signedIn: boolean | undefined, viewerId: string | null): string | null {
  return signedIn ? viewerId : null;
}
