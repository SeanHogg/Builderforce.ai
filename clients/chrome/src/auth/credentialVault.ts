interface WrappedCredential {
  version: 1;
  nonce: string;
  ciphertext: string;
}

export interface CredentialVault {
  wrap(value: string): Promise<WrappedCredential>;
  unwrap(value: WrappedCredential): Promise<string>;
}

export function isWrappedCredential(value: unknown): value is WrappedCredential {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<WrappedCredential>;
  return envelope.version === 1 && typeof envelope.nonce === 'string' && typeof envelope.ciphertext === 'string';
}

export function hasStoredCredential(value: unknown): boolean {
  return (typeof value === 'string' && value.length > 0) || isWrappedCredential(value);
}

function base64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** The wrapping key is local to this extension and never extractable. */
export function createCredentialVault(indexedDB: IDBFactory): CredentialVault {
  let loaded: Promise<CryptoKey> | undefined;
  async function loadKey(): Promise<CryptoKey> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('rovr-auth', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('credentials');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return await new Promise<CryptoKey>((resolve, reject) => {
        const transaction = db.transaction('credentials', 'readwrite');
        const store = transaction.objectStore('credentials');
        const stored = store.get('device-key');
        let key: CryptoKey;
        stored.onsuccess = () => {
          key = (stored.result as CryptoKey | undefined) ?? candidate;
          if (!stored.result) store.put(key, 'device-key');
        };
        transaction.oncomplete = () => resolve(key);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }

  function key(): Promise<CryptoKey> {
    return loaded ??= loadKey().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
  }

  return {
    async wrap(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(value));
      return { version: 1, nonce: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) };
    },
    async unwrap(value) {
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(value.nonce) }, await key(), bytes(value.ciphertext));
      return new TextDecoder().decode(clear);
    },
  };
}
