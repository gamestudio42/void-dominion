import mqtt from 'mqtt';

/**
 * A publish/subscribe channel for the handshake only. Payloads are already sealed
 * (`crypto.ts`), so a broker is trusted with nothing but delivery.
 */
export interface Broker {
  publish(topic: string, payload: string): void;
  /** Returns a function that stops the subscription. */
  subscribe(topic: string, onMessage: (payload: string) => void): () => void;
  close(): void;
}

/**
 * Public brokers that answered MQTT over secure WebSocket on 2026-11-05. Both are offered
 * for testing without a service guarantee. test.mosquitto.org:8081 refused the same probe.
 */
export const PUBLIC_BROKERS: readonly string[] = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];

/** One broker over MQTT.js. Messages are QoS 0 and never retained: a late guest relies on the host republishing. */
export function mqttBroker(url: string): Broker {
  const client = mqtt.connect(url, { reconnectPeriod: 2000, connectTimeout: 8000, clean: true });
  const handlers = new Map<string, Set<(payload: string) => void>>();
  client.on('message', (topic, payload) => {
    for (const handler of handlers.get(topic) ?? []) handler(payload.toString());
  });
  /** A failing broker is skipped by the fan-out; its errors are not the match's. */
  client.on('error', () => {});
  return {
    publish(topic, payload) {
      client.publish(topic, payload, { qos: 0, retain: false });
    },
    subscribe(topic, onMessage) {
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
        client.subscribe(topic, { qos: 0 });
      }
      set.add(onMessage);
      return () => {
        set.delete(onMessage);
        if (set.size > 0) return;
        handlers.delete(topic);
        client.unsubscribe(topic);
      };
    },
    close() {
      handlers.clear();
      client.end(true);
    },
  };
}

/**
 * Publish to every broker and listen on every broker. A payload heard on two brokers is
 * delivered once. If one broker is down or blocked on one side, the other still carries
 * the handshake.
 */
export function fanOut(brokers: readonly Broker[]): Broker {
  return {
    publish(topic, payload) {
      for (const broker of brokers) broker.publish(topic, payload);
    },
    subscribe(topic, onMessage) {
      const seen = new Set<string>();
      const stops = brokers.map((broker) =>
        broker.subscribe(topic, (payload) => {
          if (seen.has(payload)) return;
          seen.add(payload);
          onMessage(payload);
        }),
      );
      return () => {
        for (const stop of stops) stop();
      };
    },
    close() {
      for (const broker of brokers) broker.close();
    },
  };
}

/** An in-process broker for tests: every client of one hub hears every publish on its topics. */
export function memoryHub(): { client(): Broker; published: { topic: string; payload: string }[] } {
  const listeners = new Map<string, Set<(payload: string) => void>>();
  const published: { topic: string; payload: string }[] = [];
  return {
    published,
    client() {
      const mine = new Set<() => void>();
      return {
        publish(topic, payload) {
          published.push({ topic, payload });
          /** Delivered on a later task, as a network would, so no caller sees its own publish re-entrantly. */
          for (const listener of [...(listeners.get(topic) ?? [])]) queueMicrotask(() => listener(payload));
        },
        subscribe(topic, onMessage) {
          let set = listeners.get(topic);
          if (!set) {
            set = new Set();
            listeners.set(topic, set);
          }
          set.add(onMessage);
          const stop = () => {
            set.delete(onMessage);
            mine.delete(stop);
          };
          mine.add(stop);
          return stop;
        },
        close() {
          for (const stop of [...mine]) stop();
        },
      };
    },
  };
}
