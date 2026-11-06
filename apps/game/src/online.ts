import {
  fanOut,
  GuestSession,
  hostMatch,
  joinMatch,
  matchLink,
  mqttBroker,
  newSecret,
  PUBLIC_BROKERS,
  rtcPeer,
  secretFromLink,
  type Channels,
} from '@void-dominion/net';

/** How long a guest waits for its seat and first view once the channels are open. */
const SEATING_MS = 15_000;

export type OnlineFailure = 'timeout' | 'connection_failed' | 'unsupported';

export class OnlineError extends Error {
  constructor(readonly reason: OnlineFailure) {
    super(reason);
  }
}

/** WebRTC and the deflate streams the views travel in are both required. */
export function onlineSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && typeof CompressionStream !== 'undefined';
}

/** The secret in this page's `#join=` fragment, if it carries one. */
export function joinSecret(): Uint8Array | null {
  return secretFromLink(location.href);
}

/** Drop the fragment so a reload does not join again. */
export function forgetJoinLink(): void {
  history.replaceState(null, '', location.pathname + location.search);
}

/**
 * Open a match and wait for a guest. `onLink` gets the link to share as soon as it
 * exists; the promise settles when the guest's channels are open.
 */
export async function hostOnline(onLink: (link: string) => void): Promise<Channels> {
  if (!onlineSupported()) throw new OnlineError('unsupported');
  const secret = newSecret();
  onLink(matchLink(location.href, secret));
  const broker = fanOut(PUBLIC_BROKERS.map(mqttBroker));
  const peer = rtcPeer();
  try {
    return await hostMatch({ secret, broker, peer });
  } catch (error) {
    peer.close();
    throw failure(error);
  } finally {
    broker.close();
  }
}

/** Join the match in the link, then wait to be seated and for the first view. */
export async function joinOnline(secret: Uint8Array, build: string): Promise<GuestSession> {
  if (!onlineSupported()) throw new OnlineError('unsupported');
  const broker = fanOut(PUBLIC_BROKERS.map(mqttBroker));
  const peer = rtcPeer();
  let channels: Channels;
  try {
    channels = await joinMatch({ secret, broker, peer });
  } catch (error) {
    peer.close();
    throw failure(error);
  } finally {
    broker.close();
  }
  const session = new GuestSession(channels, build);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OnlineError('timeout')), SEATING_MS);
    session.onView = () => {
      if (session.seat === 0 || !session.explored) return;
      clearTimeout(timer);
      resolve();
    };
  });
  return session;
}

function failure(error: unknown): OnlineError {
  if (error instanceof OnlineError) return error;
  return new OnlineError(error instanceof Error && error.message === 'timeout' ? 'timeout' : 'connection_failed');
}
