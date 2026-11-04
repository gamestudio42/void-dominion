import { useEffect, useRef, useState } from 'react';
import { startField, type FieldUi } from './field.ts';
import { messagesFor } from './locales.ts';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const text = messagesFor(navigator.language);
  const [ui, setUi] = useState<FieldUi>({
    selectedCount: 0,
    rejection: null,
    debug: false,
    tick: 0,
    fps: 0,
    box: null,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startField(canvas, setUi, navigator.language);
  }, []);

  return (
    <div className="field">
      <canvas ref={canvasRef} />
      {ui.selectedCount > 0 && <p className="selected">{text.selected(ui.selectedCount)}</p>}
      {ui.rejection && <p className="refusal">{ui.rejection}</p>}
      {ui.debug && (
        <p className="debug">
          {text.tick(ui.tick)} · {text.fps(ui.fps)}
        </p>
      )}
      {ui.box && (
        <div
          className="box"
          style={{
            left: ui.box.left,
            top: ui.box.top,
            width: ui.box.width,
            height: ui.box.height,
          }}
        />
      )}
    </div>
  );
}
