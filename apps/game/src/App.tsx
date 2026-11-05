import { BUILDING_KINDS, BUILDINGS } from '@void-dominion/content';
import { useEffect, useRef, useState } from 'react';
import { startField, type FieldActions, type FieldUi } from './field.ts';
import { messagesFor } from './locales.ts';

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
    return startField(canvas, minimap, setUi, navigator.language, actions);
  }, []);

  const banner = ui.banner === 'victory' ? text.victory : ui.banner === 'defeat' ? text.defeat : ui.banner === 'draw' ? text.draw : null;

  return (
    <div className="field">
      <canvas ref={canvasRef} />
      <header className="topbar">
        <span>{text.ore(ui.ore)}</span>
        <span>{text.aether(ui.aether)}</span>
        <span>{text.supply(ui.supplyUsed, ui.supplyCap)}</span>
        <span className={ui.powerTake > ui.powerGive ? 'short' : undefined}>{text.power(ui.powerGive, ui.powerTake)}</span>
        <span className="clock">{ui.clock}</span>
      </header>
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
        <button type="button" onClick={() => actions.current?.saveReplay()}>{text.save}</button>
        <button type="button" onClick={() => fileRef.current?.click()}>{text.load}</button>
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
