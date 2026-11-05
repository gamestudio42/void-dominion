import type { Broker } from './broker.ts';
import { deriveKeys, open, seal } from './crypto.ts';
import type { Channels, Peer } from './peer.ts';

/** The host repeats its offer, so a guest who opens the link late still hears one. */
export const REPUBLISH_MS = 3000;
/** How long either side waits for the other before giving up. */
export const HANDSHAKE_TIMEOUT_MS = 10 * 60 * 1000;
/** An offer older than this is ignored, so a recorded one cannot be replayed into a later join. */
export const OFFER_MAX_AGE_MS = 2 * 60 * 1000;

interface Offer {
  kind: 'offer';
  from: string;
  sdp: string;
  at: number;
}

interface Answer {
  kind: 'answer';
  from: string;
  to: string;
  sdp: string;
}

export interface Handshake {
  secret: Uint8Array;
  broker: Broker;
  peer: Peer;
  timeoutMs?: number;
  /** Tests shorten this; a real host keeps `REPUBLISH_MS`. */
  republishMs?: number;
  now?: () => number;
}

/**
 * Host side: publish a sealed offer until a sealed answer addressed to it arrives, then
 * accept it and wait for the channels. Anything on the topic that does not open with the
 * match key, or is not addressed to this host, is ignored.
 */
export async function hostMatch(options: Handshake): Promise<Channels> {
  const { broker, peer } = options;
  const now = options.now ?? Date.now;
  const { topic, key } = await deriveKeys(options.secret);
  const id = sessionId();
  const sdp = await peer.offer();
  let answered = false;
  const stop = broker.subscribe(topic, (payload) => {
    if (answered) return;
    void open(key, payload).then((value) => {
      if (answered || !isAnswer(value) || value.to !== id) return;
      answered = true;
      void peer.accept(value.sdp).catch(() => {});
    });
  });
  const announce = () => {
    if (answered) return;
    const offer: Offer = { kind: 'offer', from: id, sdp, at: now() };
    void seal(key, offer).then((sealed) => broker.publish(topic, sealed));
  };
  announce();
  const timer = setInterval(announce, options.republishMs ?? REPUBLISH_MS);
  try {
    return await within(peer.open, options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);
  } finally {
    answered = true;
    clearInterval(timer);
    stop();
  }
}

/**
 * Guest side: answer the first fresh offer, and answer it again each time the host
 * repeats it, since a broker may drop a message. Offers from another host session are
 * ignored once one is chosen.
 */
export async function joinMatch(options: Handshake): Promise<Channels> {
  const { broker, peer } = options;
  const now = options.now ?? Date.now;
  const { topic, key } = await deriveKeys(options.secret);
  const id = sessionId();
  let chosen: string | null = null;
  let answer: Promise<string> | null = null;
  const stop = broker.subscribe(topic, (payload) => {
    void open(key, payload).then(async (value) => {
      if (!isOffer(value) || now() - value.at > OFFER_MAX_AGE_MS) return;
      if (chosen !== null && value.from !== chosen) return;
      if (chosen === null) {
        chosen = value.from;
        answer = peer.answer(value.sdp);
      }
      const reply: Answer = { kind: 'answer', from: id, to: value.from, sdp: await answer! };
      broker.publish(topic, await seal(key, reply));
    }).catch(() => {});
  });
  try {
    return await within(peer.open, options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);
  } finally {
    stop();
  }
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function sessionId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOffer(value: unknown): value is Offer {
  return isRecord(value) && value.kind === 'offer' && typeof value.from === 'string' && typeof value.sdp === 'string' && typeof value.at === 'number';
}

function isAnswer(value: unknown): value is Answer {
  return isRecord(value) && value.kind === 'answer' && typeof value.from === 'string' && typeof value.to === 'string' && typeof value.sdp === 'string';
}
