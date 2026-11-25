import { BUILDING_KINDS, BUILDINGS } from '@void-dominion/content';
import { formatFieldReport } from '@void-dominion/net';
import { deserializeReplay } from '@void-dominion/simulation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { decodeReplayLink } from '../../../packages/arena/src/sandbox.ts';
import { ArenaPanel } from './arena.tsx';
import { startField, type FieldActions, type FieldMode, type FieldUi } from './field.ts';
import { messagesFor } from './locales.ts';
import { forgetJoinLink, hostOnline, joinOnline, joinSecret, OnlineError, type OnlineFailure } from './online.ts';

/** Sent in `hello`, so a host can tell which build a guest runs. */
const BUILD = 'web';

/** The versioned example, served next to the page on GitHub Pages and in dev. */
export const EXAMPLE_REPLAY = 'replays/reference-varek.json';

type Screen =
  | { kind: 'menu' }
  | { kind: 'arena' }
  | { kind: 'hosting'; link: string | null }
  | { kind: 'joining' }
  | { kind: 'loading-replay' }
  | { kind: 'failed'; reason: OnlineFailure }
  | { kind: 'playing'; mode: FieldMode };

function replayRequest(): string | null {
  const value = new URLSearchParams(location.search).get('replay');
  return value && value.length > 0 ? value : null;
}

function replayDataRequest(): string | null {
  const value = new URLSearchParams(location.search).get('replay-data');
  return value && value.length > 0 ? value : null;
}

const EMPTY: FieldUi = {
  paused: false,
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
  card: null,
  contact: false,
  banner: null,
  online: null,
  latency: null,
  peerGone: false,
  audit: null,
  auditReason: null,
  iceLocal: null,
  iceRemote: null,
  drops: 0,
  playback: null,
};

export function App() {
  const text = messagesFor(navigator.language);
  const joining = useRef(false);
  const menuFile = useRef<HTMLInputElement>(null);
  const [replayError, setReplayError] = useState(false);
  const [screen, setScreen] = useState<Screen>(() => {
    if (joinSecret()) return { kind: 'joining' };
    if (replayDataRequest() || replayRequest()) return { kind: 'loading-replay' };
    return { kind: 'menu' };
  });

  function openReplay(body: string): void {
    const file = deserializeReplay(body);
    if (!file) {
      setReplayError(true);
      setScreen({ kind: 'menu' });
      return;
    }
    setReplayError(false);
    setScreen({ kind: 'playing', mode: { kind: 'replay', file } });
  }

  function loadReplayUrl(url: string): void {
    setReplayError(false);
    setScreen({ kind: 'loading-replay' });
    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('missing');
        return response.text();
      })
      .then((body) => openReplay(body))
      .catch(() => {
        setReplayError(true);
        setScreen({ kind: 'menu' });
      });
  }

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

  useEffect(() => {
    if (joinSecret()) return;
    const packed = replayDataRequest();
    if (packed) {
      void decodeReplayLink(packed)
        .then((body) => openReplay(body))
        .catch(() => {
          setReplayError(true);
          setScreen({ kind: 'menu' });
        });
      return;
    }
    const url = replayRequest();
    if (!url) return;
    loadReplayUrl(url);
  }, []);

  function host(): void {
    setScreen({ kind: 'hosting', link: null });
    hostOnline((link) => setScreen({ kind: 'hosting', link })).then(
      (channels) => setScreen({ kind: 'playing', mode: { kind: 'host', channels } }),
      (error: unknown) => setScreen({ kind: 'failed', reason: error instanceof OnlineError ? error.reason : 'connection_failed' }),
    );
  }

  if (screen.kind === 'playing') return <Field mode={screen.mode} onExit={() => {
    if (screen.mode.kind === 'host' || screen.mode.kind === 'guest') {
      // A new document closes the peer connection, including all session listeners.
      location.assign(location.pathname);
      return;
    }
    history.replaceState(null, '', location.pathname);
    setScreen({ kind: 'menu' });
  }} />;
  return (
    <>
      <Poster />
      <main className="menu">
        <section className={screen.kind === 'arena' ? 'menu-card wide' : 'menu-card'}>
          <p className="eyebrow">{text.frontier}</p>
          <h1>{text.title}</h1>
          <p className="tagline">{text.tagline}</p>
          {screen.kind === 'menu' && (
            <>
              <button type="button" onClick={() => setScreen({ kind: 'playing', mode: { kind: 'offline' } })}>
                {text.skirmish}
              </button>
              <button type="button" onClick={host}>
                {text.host_match}
              </button>
              <button type="button" onClick={() => setScreen({ kind: 'arena' })}>
                {text.arena}
              </button>
              <button type="button" onClick={() => loadReplayUrl(EXAMPLE_REPLAY)}>
                {text.replay_watch}
              </button>
              <button type="button" onClick={() => menuFile.current?.click()}>
                {text.replay_open}
              </button>
              {replayError && <p className="failure">{text.replay_invalid}</p>}
              <input
                ref={menuFile}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  void file.text().then((body) => openReplay(body));
                }}
              />
            </>
          )}
          {screen.kind === 'arena' && <ArenaPanel onBack={() => setScreen({ kind: 'menu' })} onWatch={openReplay} />}
          {screen.kind === 'loading-replay' && <p>{text.replay_loading}</p>}
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
        </section>
      </main>
    </>
  );
}

/** The opening, frozen. The match starts only when a button leaves this screen. */
function Poster() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const minimap = mapRef.current;
    if (!canvas || !minimap) return;
    return startField(canvas, minimap, () => {}, navigator.language, { current: null }, { kind: 'poster' });
  }, []);
  return (
    <>
      <canvas ref={canvasRef} className="poster" />
      <canvas ref={mapRef} hidden />
    </>
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

function Field({ mode, onExit }: { mode: FieldMode; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const actions = useRef<FieldActions | null>(null);
  const text = messagesFor(navigator.language);
  const [ui, setUi] = useState<FieldUi>(EMPTY);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const minimap = mapRef.current;
    if (!canvas || !minimap) return;
    return startField(canvas, minimap, setUi, navigator.language, actions, mode);
  }, [mode]);

  const banner = ui.banner === 'victory' ? text.victory : ui.banner === 'defeat' ? text.defeat : ui.banner === 'draw' ? text.draw : null;
  const resultDetail = ui.banner === 'victory' ? text.victory_detail : ui.banner === 'defeat' ? text.defeat_detail : text.draw_detail;
  const canSave = ui.online !== 'guest' || ui.audit !== null;
  const offline = mode.kind === 'offline';
  const result = Boolean(banner) && !ui.playback;
  const audit = ui.online && banner ? (ui.audit === 'ok' ? text.verified : ui.audit === 'failed' ? text.unverified : text.audit_checking) : null;
  const diagnostics = ui.online
    ? formatFieldReport({
        role: ui.online,
        tick: ui.tick,
        pingMs: ui.latency,
        iceLocal: ui.iceLocal,
        iceRemote: ui.iceRemote,
        drops: ui.drops,
        audit: ui.audit === 'ok' ? 'pass' : ui.audit === 'failed' ? 'fail' : 'pending',
        auditReason: ui.auditReason,
        result: ui.banner ?? 'playing',
      })
    : '';

  return (
    <div className="field">
      <canvas ref={canvasRef} />
      <header className="topbar">
        <span className="chip ore">{text.ore(ui.ore)}</span>
        <span className="chip aether">{text.aether(ui.aether)}</span>
        <span className="chip supply">{text.supply(ui.supplyUsed, ui.supplyCap)}</span>
        <span className={ui.powerTake > ui.powerGive ? 'chip power short' : 'chip power'}>{text.power(ui.powerGive, ui.powerTake)}</span>
        {ui.latency !== null && <span className="chip">{text.latency(ui.latency)}</span>}
        <span className="clock">{ui.clock}</span>
      </header>
      {!ui.playback && <div className="session-controls">
        <p className="objective">{text.objective}</p>
        {!banner && (offline
          ? <button type="button" onClick={() => actions.current?.togglePause()}>{text.pause_menu}</button>
          : <button type="button" onClick={() => setLeaving(true)}>{text.leave_match}</button>)}
      </div>}
      {ui.peerGone && !banner && <p className="contact">{text.peer_left}</p>}
      {ui.card && (
        <section className="card">
          <p className="selected">{ui.card.title}</p>
          {ui.card.maxHp > 0 && (
            <>
              <p>{text.hp(ui.card.hp, ui.card.maxHp)}</p>
              <div className="hp">
                <span style={{ width: `${Math.max(0, Math.min(100, (ui.card.hp / ui.card.maxHp) * 100))}%` }} />
              </div>
            </>
          )}
          {ui.card.damage > 0 && <p>{text.damage(ui.card.damage)}</p>}
          {ui.card.range > 0 && <p>{text.reach(ui.card.range)}</p>}
          {(ui.card.ore > 0 || ui.card.aether > 0) && <p>{text.cost_label(ui.card.ore, ui.card.aether)}</p>}
          {ui.card.production && <div className="production">
            {ui.card.production.construction < 100 && <>
              <p>{text.construction_progress(ui.card.production.construction)}</p>
              <progress aria-label={text.construction_progress(ui.card.production.construction)} value={ui.card.production.construction} max={100} />
            </>}
            {ui.card.production.available && <>
              <p className="selected">{text.production}</p>
              <p data-testid="production-current">{ui.card.production.current
                ? text.production_current(text.unitName(ui.card.production.current.kind), ui.card.production.current.seconds)
                : text.production_idle}</p>
              {ui.card.production.current && <progress aria-label={text.production} value={ui.card.production.current.percent} max={100} />}
              <p data-testid="production-queue">{text.production_queue(ui.card.production.queue.length)}</p>
              {ui.card.production.queue.length > 0 && <ol>{ui.card.production.queue.map((kind, index) => <li key={index}>{text.unitName(kind)}</li>)}</ol>}
              {ui.card.production.powerShort && (ui.card.production.current || ui.card.production.queue.length > 0) && <p className="power-warning">{text.production_power}</p>}
            </>}
          </div>}
        </section>
      )}
      {ui.rejection && <p className="refusal" role="status">{ui.rejection}</p>}
      {ui.debug && (
        <p className="debug">
          {text.tick(ui.tick)} · {text.fps(ui.fps)}
        </p>
      )}
      {ui.contact && !banner && <p className="contact">{text.contact}</p>}
      {banner && ui.playback && <p className="banner">{banner}</p>}
      {ui.paused && !result && <SessionDialog title={text.paused} onDismiss={() => actions.current?.togglePause()}>
        <p>{text.pause_help}</p>
        <p>{text.duration(ui.clock)}</p>
        <button type="button" autoFocus onClick={() => actions.current?.togglePause()}>{text.resume}</button>
        <button type="button" onClick={() => actions.current?.saveReplay()}>{text.save}</button>
        <button type="button" onClick={() => actions.current?.restart()}>{text.restart}</button>
        <button type="button" onClick={onExit}>{text.menu}</button>
      </SessionDialog>}
      {result && !leaving && <SessionDialog title={banner!}>
        <p>{resultDetail}</p>
        <p>{text.duration(ui.clock)}</p>
        {audit && <p className={ui.audit === 'failed' ? 'power-warning' : 'audit-result'} role="status">{audit}</p>}
        {ui.online && <MatchDiagnostics note={diagnostics} />}
        {canSave && <button type="button" onClick={() => actions.current?.saveReplay()}>{text.save}</button>}
        {offline && <button type="button" onClick={() => actions.current?.restart()}>{text.play_again}</button>}
        <button type="button" onClick={() => ui.online && !ui.audit ? setLeaving(true) : onExit()}>{text.menu}</button>
      </SessionDialog>}
      {leaving && <SessionDialog title={text.leave_match} onDismiss={() => setLeaving(false)}>
        <p>{result ? text.leave_result : ui.online === 'host' ? text.leave_host : text.leave_guest}</p>
        <button type="button" autoFocus onClick={() => setLeaving(false)}>{text.keep_playing}</button>
        <button type="button" onClick={onExit}>{text.leave_match}</button>
      </SessionDialog>}
      {ui.box && (
        <div
          className="box"
          style={{ left: ui.box.left, top: ui.box.top, width: ui.box.width, height: ui.box.height }}
        />
      )}
      <canvas ref={mapRef} className="minimap" width={168} height={168} />
      {ui.online && !result && <MatchDiagnostics note={diagnostics} />}
      {ui.playback && (
        <section className="playback">
          <button type="button" onClick={() => actions.current?.togglePlayback()}>
            {ui.playback.playing ? text.replay_pause : text.replay_play}
          </button>
          {([1, 2, 4] as const).map((speed) => (
            <button
              key={speed}
              type="button"
              className={ui.playback?.speed === speed ? 'active' : undefined}
              onClick={() => actions.current?.setPlaybackSpeed(speed)}
            >
              {text.replay_speed(speed)}
            </button>
          ))}
          <input
            type="range"
            min={0}
            max={ui.playback.length}
            value={Math.min(ui.playback.tick, ui.playback.length)}
            aria-label={text.tick(ui.playback.tick)}
            onChange={(event) => actions.current?.seekPlayback(Number(event.target.value))}
          />
          <span className="outcome">{ui.playback.outcome}</span>
          <span className="clock">{text.tick(ui.playback.tick)}</span>
          <button type="button" onClick={onExit}>
            {text.replay_back}
          </button>
        </section>
      )}
      {!ui.playback && (
      <fieldset className="commands" disabled={ui.paused || result || leaving}>
        {!ui.card && <p className="selection-hint">{text.no_selection}</p>}
        <button type="button" onClick={() => actions.current?.stop()}>
          <Glyph name="stop" />
          {text.stop}
        </button>
        <button type="button" onClick={() => actions.current?.mine()}>
          <Glyph name="mine" />
          {text.mine}
        </button>
        <button type="button" className={ui.mode === 'attack' ? 'active' : undefined} onClick={() => actions.current?.attack()}>
          <Glyph name="attack" />
          {text.attack}
        </button>
        <button type="button" className={ui.buildOpen ? 'active' : undefined} onClick={() => actions.current?.toggleBuild()}>
          <Glyph name="build" />
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
      </fieldset>
      )}
    </div>
  );
}

function MatchDiagnostics({ note }: { note: string }) {
  const text = messagesFor(navigator.language);
  const [copied, setCopied] = useState(false);
  return <section className="diagnostics">
    <textarea readOnly aria-label={text.diagnostics} value={note} onFocus={(event) => event.target.select()} />
    <button type="button" onClick={() => void navigator.clipboard?.writeText(note).then(() => setCopied(true))}>
      {copied ? text.diagnostics_copied : text.copy_diagnostics}
    </button>
  </section>;
}

/** Native modal provides focus containment and makes the field inert while open. */
function SessionDialog({ title, children, onDismiss }: { title: string; children: ReactNode; onDismiss?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="session-dialog" aria-labelledby="session-title" onCancel={(event) => {
    event.preventDefault();
    onDismiss?.();
  }}>
    <h2 id="session-title">{title}</h2>
    {children}
  </dialog>;
}

function Glyph({ name }: { name: 'stop' | 'mine' | 'attack' | 'build' }) {
  const common = { className: 'glyph', viewBox: '0 0 16 16', 'aria-hidden': true as const };
  if (name === 'stop') {
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="9" height="9" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'mine') {
    return (
      <svg {...common}>
        <path d="M3 13 L7 5 L9 8 L13 2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="4" cy="13" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'attack') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 2 V5 M8 11 V14 M2 8 H5 M11 8 H14" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M7 2 H9 V7 H14 V9 H9 V14 H7 V9 H2 V7 H7 Z" fill="currentColor" />
    </svg>
  );
}
