import { BUILDING_KINDS, BUILDINGS } from '@void-dominion/content';
import { useEffect, useRef, useState } from 'react';
import { startField, type FieldActions, type FieldMode, type FieldUi } from './field.ts';
import { messagesFor } from './locales.ts';
import { forgetJoinLink, hostOnline, joinOnline, joinSecret, OnlineError, type OnlineFailure } from './online.ts';

/** Sent in `hello`, so a host can tell which build a guest runs. */
const BUILD = 'web';

type Screen =
  | { kind: 'menu' }
  | { kind: 'hosting'; link: string | null }
  | { kind: 'joining' }
  | { kind: 'failed'; reason: OnlineFailure }
  | { kind: 'playing'; mode: FieldMode };

const EMPTY: FieldUi = {
  selectedLabel: '',
  rejection: null,
  debug: false,
  tick: 0,
  fps: 0,
  box: null,
  ore: 0,
  aether: 0,
  supplyUsed: 0,
  supplyCap: 0,
  powerGive: 0,
  powerTake: 0,
  clock: '0:00',
  mode: 'none',
  buildKind: null,
  buildOpen: false,
  trains: [],
  contact: false,
  banner: null,
  online: null,
  latency: null,
  peerGone: false,
  audit: null,
};

export function App() {
  const text = messagesFor(navigator.language);
  const joining = useRef(false);
  const [screen, setScreen] = useState<Screen>(() => (joinSecret() ? { kind: 'joining' } : { kind: 'menu' }));

  /** A `#join=` link joins at once. The ref keeps React's double effect in development from joining twice. */
  useEffect(() => {
    const secret = joinSecret();
    if (!secret || joining.current) return;
    joining.current = true;
    joinOnline(secret, BUILD).then(
      (session) => {
        forgetJoinLink();
        setScreen({ kind: 'playing', mode: { kind: 'guest', session } });
      },
      (error: unknown) => setScreen({ kind: 'failed', reason: error instanceof OnlineError ? error.reason : 'connection_failed' }),
    );
  }, []);

  function host(): void {
    setScreen({ kind: 'hosting', link: null });
    hostOnline((link) => setScreen({ kind: 'hosting', link })).then(
      (channels) => setScreen({ kind: 'playing', mode: { kind: 'host', channels } }),
      (error: unknown) => setScreen({ kind: 'failed', reason: error instanceof OnlineError ? error.reason : 'connection_failed' }),
    );
  }

  if (screen.kind === 'playing') return <Field mode={screen.mode} />;
  return (
    <main className="menu">
      <h1>{text.title}</h1>
      {screen.kind === 'menu' && (
        <>
          <button type="button" onClick={() => setScreen({ kind: 'playing', mode: { kind: 'offline' } })}>
            {text.skirmish}
          </button>
          <button type="button" onClick={host}>
            {text.host_match}
          </button>
        </>
      )}
      {screen.kind === 'hosting' && (
        <>
          <p>{text.host_waiting}</p>
          {screen.link && <Link link={screen.link} copy={text.copy} copied={text.copied} />}
        </>
      )}
      {screen.kind === 'joining' && <p>{text.joining}</p>}
      {screen.kind === 'failed' && (
        <>
          <p className="failure">
            {screen.reason === 'timeout' ? text.fail_timeout : screen.reason === 'unsupported' ? text.fail_unsupported : text.fail_connection}
          </p>
          <button type="button" onClick={() => location.assign(location.pathname + location.search)}>
            {text.back}
          </button>
        </>
      )}
    </main>
  );
}

function Link({ link, copy, copied }: { link: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="link">
      <input readOnly value={link} onFocus={(event) => event.target.select()} />
      <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => setDone(true))}>
        {done ? copied : copy}
      </button>
    </div>
  );
}

function Field({ mode }: { mode: FieldMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const actions = useRef<FieldActions | null>(null);
  const text = messagesFor(navigator.language);
  const [ui, setUi] = useState<FieldUi>(EMPTY);

  useEffect(() => {
    const canvas = canvasRef.current;
    const minimap = mapRef.current;
    if (!canvas || !minimap) return;
    return startField(canvas, minimap, setUi, navigator.language, actions, mode);
  }, [mode]);

  const banner = ui.banner === 'victory' ? text.victory : ui.banner === 'defeat' ? text.defeat : ui.banner === 'draw' ? text.draw : null;

  return (
    <div className="field">
      <canvas ref={canvasRef} />
      <header className="topbar">
        <span>{text.ore(ui.ore)}</span>
        <span>{text.aether(ui.aether)}</span>
        <span>{text.supply(ui.supplyUsed, ui.supplyCap)}</span>
        <span className={ui.powerTake > ui.powerGive ? 'short' : undefined}>{text.power(ui.powerGive, ui.powerTake)}</span>
        {ui.latency !== null && <span>{text.latency(ui.latency)}</span>}
        <span className="clock">{ui.clock}</span>
      </header>
      {ui.peerGone && !banner && <p className="contact">{text.peer_left}</p>}
      {banner && ui.audit && <p className={ui.audit === 'ok' ? 'audit' : 'audit failed'}>{ui.audit === 'ok' ? text.verified : text.unverified}</p>}
      {ui.selectedLabel && <p className="selected">{ui.selectedLabel}</p>}
      {ui.rejection && <p className="refusal">{ui.rejection}</p>}
      {ui.debug && (
        <p className="debug">
          {text.tick(ui.tick)} · {text.fps(ui.fps)}
        </p>
      )}
      {ui.contact && !banner && <p className="contact">{text.contact}</p>}
      {banner && <p className="banner">{banner}</p>}
      {ui.box && (
        <div
          className="box"
          style={{ left: ui.box.left, top: ui.box.top, width: ui.box.width, height: ui.box.height }}
        />
      )}
      <canvas ref={mapRef} className="minimap" width={168} height={168} />
      <section className="commands">
        <button type="button" onClick={() => actions.current?.stop()}>{text.stop}</button>
        <button type="button" onClick={() => actions.current?.mine()}>{text.mine}</button>
        <button type="button" className={ui.mode === 'attack' ? 'active' : undefined} onClick={() => actions.current?.attack()}>
          {text.attack}
        </button>
        <button type="button" className={ui.buildOpen ? 'active' : undefined} onClick={() => actions.current?.toggleBuild()}>
          {text.build}
        </button>
        {ui.trains.map((train) => (
          <button key={train.kind} type="button" onClick={() => actions.current?.produce(train.kind)}>
            {text.train(text.unitName(train.kind), train.ore, train.aether)}
          </button>
        ))}
        {ui.buildOpen &&
          BUILDING_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={ui.buildKind === kind ? 'active' : undefined}
              onClick={() => actions.current?.chooseBuild(kind)}
            >
              {text.train(text.buildingName(kind), BUILDINGS[kind].ore, BUILDINGS[kind].aether)}
            </button>
          ))}
        {(ui.online !== 'guest' || ui.audit !== null) && (
          <button type="button" onClick={() => actions.current?.saveReplay()}>{text.save}</button>
        )}
        {ui.online === null && <button type="button" onClick={() => fileRef.current?.click()}>{text.load}</button>}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void file.text().then((body) => actions.current?.loadReplay(body));
          }}
        />
      </section>
    </div>
  );
}
