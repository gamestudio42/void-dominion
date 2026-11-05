/** One direction-agnostic pipe between host and guest. */
export interface Channel {
  send(data: string | Uint8Array): void;
  onMessage(handler: (data: string | Uint8Array) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

/**
 * The two pipes of a match: commands, acks and the end message must all arrive in
 * order; a view is replaced 100 ms later, so a lost one is not resent.
 */
export interface Channels {
  reliable: Channel;
  views: Channel;
}

/**
 * The connection under the handshake. The host makes an offer and accepts an answer;
 * the guest answers an offer. Offers and answers are opaque text carried, sealed, by the
 * broker. `open` settles when both channels can carry data, or rejects when the
 * connection fails.
 */
export interface Peer {
  offer(): Promise<string>;
  answer(offer: string): Promise<string>;
  accept(answer: string): Promise<void>;
  readonly open: Promise<Channels>;
  close(): void;
}

/** A public STUN server, for finding each side's address. There is no TURN relay (decision 024). */
export const STUN_SERVERS: readonly string[] = ['stun:stun.l.google.com:19302'];

/** WebRTC in a browser. Non-trickle: an offer or answer is sent once ICE gathering is complete. */
export function rtcPeer(stun: readonly string[] = STUN_SERVERS): Peer {
  const connection = new RTCPeerConnection({ iceServers: [{ urls: [...stun] }] });
  let settle: (channels: Channels) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const open = new Promise<Channels>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'failed') fail(new Error('connection_failed'));
  });
  const pending = new Map<string, RTCDataChannel>();
  const adopt = (channel: RTCDataChannel) => {
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => {
      pending.set(channel.label, channel);
      const reliable = pending.get('reliable');
      const views = pending.get('views');
      if (reliable && views) settle({ reliable: wrap(reliable), views: wrap(views) });
    });
  };
  return {
    open,
    async offer() {
      adopt(connection.createDataChannel('reliable', { ordered: true }));
      adopt(connection.createDataChannel('views', { ordered: false, maxRetransmits: 0 }));
      await connection.setLocalDescription(await connection.createOffer());
      await gathered(connection);
      return connection.localDescription!.sdp;
    },
    async answer(offer) {
      connection.addEventListener('datachannel', (event) => adopt(event.channel));
      await connection.setRemoteDescription({ type: 'offer', sdp: offer });
      await connection.setLocalDescription(await connection.createAnswer());
      await gathered(connection);
      return connection.localDescription!.sdp;
    },
    async accept(answer) {
      await connection.setRemoteDescription({ type: 'answer', sdp: answer });
    },
    close() {
      connection.close();
    },
  };
}

function gathered(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (connection.iceGatheringState !== 'complete') return;
      connection.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    connection.addEventListener('icegatheringstatechange', check);
  });
}

function wrap(channel: RTCDataChannel): Channel {
  return {
    send(data) {
      if (channel.readyState !== 'open') return;
      if (typeof data === 'string') channel.send(data);
      else channel.send(new Uint8Array(data));
    },
    onMessage(handler) {
      channel.addEventListener('message', (event) =>
        handler(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer)),
      );
    },
    onClose(handler) {
      channel.addEventListener('close', handler);
    },
    close() {
      channel.close();
    },
  };
}

/** In-process peers for tests. An offer names a slot; the answer to it joins the two ends. */
export function memoryPeers(): () => Peer {
  const offers = new Map<string, (channels: Channels) => void>();
  const answers = new Map<string, () => void>();
  let next = 0;
  return () => {
    let settle: (channels: Channels) => void = () => {};
    const open = new Promise<Channels>((resolve) => {
      settle = resolve;
    });
    let ends: [Channels, Channels] | null = null;
    return {
      open,
      async offer() {
        const slot = `memory-offer-${next++}`;
        offers.set(slot, settle);
        return slot;
      },
      async answer(offer) {
        const openHost = offers.get(offer);
        if (!openHost) throw new Error('unknown offer');
        offers.delete(offer);
        const hostSide = memoryChannels();
        const guestSide = memoryChannels();
        link(hostSide, guestSide);
        ends = [hostSide, guestSide];
        const answer = `memory-answer-${next++}`;
        /** As with WebRTC, the host's side opens only once it accepts the answer. */
        answers.set(answer, () => openHost(hostSide));
        settle(guestSide);
        return answer;
      },
      async accept(answer) {
        const openHost = answers.get(answer);
        if (!openHost) throw new Error('unknown answer');
        answers.delete(answer);
        openHost();
      },
      close() {
        for (const side of ends ?? []) {
          side.reliable.close();
          side.views.close();
        }
      },
    };
  };
}

interface MemoryChannel extends Channel {
  deliver(data: string | Uint8Array): void;
  shut(): void;
  other?: MemoryChannel;
}

function memoryChannels(): Channels & { reliable: MemoryChannel; views: MemoryChannel } {
  return { reliable: memoryChannel(), views: memoryChannel() };
}

function memoryChannel(): MemoryChannel {
  const handlers: ((data: string | Uint8Array) => void)[] = [];
  const closers: (() => void)[] = [];
  const backlog: (string | Uint8Array)[] = [];
  let closed = false;
  const channel: MemoryChannel = {
    send(data) {
      if (closed || !channel.other) return;
      const copy = typeof data === 'string' ? data : new Uint8Array(data);
      const target = channel.other;
      queueMicrotask(() => target.deliver(copy));
    },
    onMessage(handler) {
      handlers.push(handler);
      for (const data of backlog.splice(0)) handler(data);
    },
    onClose(handler) {
      closers.push(handler);
    },
    close() {
      if (closed) return;
      channel.shut();
      channel.other?.shut();
    },
    deliver(data) {
      if (closed) return;
      if (handlers.length === 0) backlog.push(data);
      for (const handler of handlers) handler(data);
    },
    shut() {
      if (closed) return;
      closed = true;
      for (const closer of closers) closer();
    },
  };
  return channel;
}

function link(a: Channels & { reliable: MemoryChannel; views: MemoryChannel }, b: Channels & { reliable: MemoryChannel; views: MemoryChannel }): void {
  a.reliable.other = b.reliable;
  b.reliable.other = a.reliable;
  a.views.other = b.views;
  b.views.other = a.views;
}
