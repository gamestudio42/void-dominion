/**
 * The match link carries a random secret in its fragment. Everything the public broker
 * carries is sealed with a key derived from it, so the broker, and anyone else on the
 * topic, sees only noise. WebCrypto only: it is built into browsers and Node 22.
 */

const SECRET_BYTES = 16;
const TOPIC_ROOT = 'void-dominion/v1/';
const HKDF_SALT = new TextEncoder().encode('void-dominion signaling v1');
const HKDF_INFO = new TextEncoder().encode('aes-256-gcm');
const IV_BYTES = 12;

export interface MatchKeys {
  /** Broker topic for this match. Derived from the secret, but not secret itself. */
  topic: string;
  key: CryptoKey;
}

export function newSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

export function secretToText(secret: Uint8Array): string {
  return toBase64Url(secret);
}

/** Null unless the text is exactly one secret. */
export function secretFromText(text: string): Uint8Array | null {
  const bytes = fromBase64Url(text);
  return bytes && bytes.length === SECRET_BYTES ? bytes : null;
}

/** `#join=<secret>` on the game's own address. The fragment never reaches a server. */
export function matchLink(base: string, secret: Uint8Array): string {
  return `${base.split('#')[0]}#join=${secretToText(secret)}`;
}

export function secretFromLink(link: string): Uint8Array | null {
  const match = /#join=([A-Za-z0-9_-]+)$/.exec(link);
  return match ? secretFromText(match[1]!) : null;
}

export async function deriveKeys(secret: Uint8Array): Promise<MatchKeys> {
  /** A copy on its own ArrayBuffer, as WebCrypto's types ask. */
  const bytes = new Uint8Array(secret);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const topic = TOPIC_ROOT + toHex(digest.subarray(0, 16));
  const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { topic, key };
}

/** Encrypt and authenticate one message: base64url of a fresh IV followed by the ciphertext. */
export async function seal(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const packed = new Uint8Array(IV_BYTES + cipher.length);
  packed.set(iv);
  packed.set(cipher, IV_BYTES);
  return toBase64Url(packed);
}

/** The value inside a sealed message, or null when it was not sealed with this key or was altered. */
export async function open(key: CryptoKey, text: string): Promise<unknown> {
  const packed = fromBase64Url(text);
  if (!packed || packed.length <= IV_BYTES) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, IV_BYTES) }, key, packed.slice(IV_BYTES));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
