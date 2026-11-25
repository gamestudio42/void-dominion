/* global process, fetch, WebSocket, console, setTimeout, clearTimeout */
/** Local Chromium UI acceptance checks. No broker, model or installed browser library is required. */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve('.');
const work = await mkdtemp(join(tmpdir(), 'vd-smoke-'));
const artifacts = resolve('test-results/browser');
await mkdir(artifacts, { recursive: true });
const replayTool = resolve('tools/browser/replays.ts');
const replayArgs = ['--experimental-transform-types', '--no-warnings', replayTool];
execFileSync(process.execPath, [...replayArgs, 'create', work]);
const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';
const server = process.env.SMOKE_URL ? null : spawn(process.execPath, [
  resolve('apps/game/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort',
], { cwd: resolve('apps/game'), stdio: 'ignore' });

// SwiftShader at 1080p can run below real time. These are functional waits, not timing gates.
async function until(read, label, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(2000)]);
  }
}

function connection(address) {
  const ws = new WebSocket(address);
  const pending = new Map();
  const errors = [];
  let next = 0;
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
    else entry.resolve(msg.result);
  });
  return {
    errors,
    async call(method, params = {}) {
      await opened;
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

async function run(language, width, height, touch = false) {
  const name = `${language}-${width}x${height}`;
  if (process.env.SMOKE_CASE && !name.includes(process.env.SMOKE_CASE)) return;
  console.log(`RUN ${name}`);
  const profile = join(work, name);
  const downloads = join(profile, 'downloads');
  await mkdir(downloads, { recursive: true });
  const browser = spawn(process.env.CHROME ?? '/usr/bin/google-chrome-stable', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let page;
  const pt = language === 'pt-BR';
  const label = {
    start: pt ? 'Escaramuça contra o General Varek' : 'Skirmish vs General Varek',
    pause: pt ? 'Pausar / menu' : 'Pause / menu', resume: pt ? 'Continuar' : 'Resume',
    restart: pt ? 'Reiniciar partida' : 'Restart match', menu: pt ? 'Voltar ao menu' : 'Back to the menu',
    stop: pt ? 'Parar' : 'Stop', build: pt ? 'Construir' : 'Build',
    barracks: pt ? 'Quartel 150' : 'Barracks 150', rifle: pt ? 'Fuzileiro 50' : 'Rifleman 50',
    save: pt ? 'Salvar replay' : 'Save replay', again: pt ? 'Jogar novamente' : 'Play again',
    victory: pt ? 'Vitória' : 'Victory', defeat: pt ? 'Derrota' : 'Defeat',
  };
  try {
    const port = await until(async () => {
      try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
      catch { return null; }
    }, 'Chrome debugger');
    const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
    page = connection(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
    const evaluate = async (expression) => {
      const value = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    const wait = (expression, label, ms) => until(() => evaluate(`Boolean(${expression})`), label, ms);
    const button = async (text) => {
      await wait(`(() => {
        const scope = document.querySelector('dialog[open]') ?? document;
        const el = [...scope.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.matches(':disabled'));
        if (!el) return false; el.click(); return true;
      })()`, `button ${text}`);
    };
    const click = async ({ x, y }) => {
      await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const point = (x, y) => evaluate(`window.__vd.project(${x}, ${y})`);
    const screenshot = async (suffix) => {
      const result = await page.call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(artifacts, `${name}-${suffix}.png`), Buffer.from(result.data, 'base64'));
    };
    const loadReplay = async (path) => {
      const { root: document } = await page.call('DOM.getDocument');
      const { nodeId } = await page.call('DOM.querySelector', { nodeId: document.nodeId, selector: '.commands input[type=file]' });
      await page.call('DOM.setFileInputFiles', { nodeId, files: [path] });
    };
    const checkExport = async () => {
      const expected = await evaluate('window.__vd.read()');
      await button(label.save);
      const path = join(downloads, 'void-dominion-replay.json');
      await until(async () => { try { return (await readFile(path)).length > 0; } catch { return false; } }, 'replay download');
      const actual = JSON.parse(execFileSync(process.execPath, [...replayArgs, 'verify', path], { cwd: root, encoding: 'utf8' }));
      assert.deepEqual(actual, { checksum: expected.checksum, tick: expected.tick, winner: expected.winner });
      await rm(path);
    };
    await page.call('Runtime.enable');
    await page.call('Page.enable');
    await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
    if (touch) await page.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const { userAgent } = await page.call('Browser.getVersion');
    await page.call('Network.setUserAgentOverride', { userAgent, acceptLanguage: language });
    await page.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.call('Page.navigate', { url });
    await button(label.start);
    await wait('window.__vd && window.__vd.read().tick > 2', 'skirmish starts');
    if (touch) {
      await wait('window.__vd.read().tick > 20', 'touch field has rendered');
      assert.equal(await evaluate(`(() => {
        const controls = document.querySelector('.session-controls').getBoundingClientRect();
        return ['.topbar', '.minimap'].every(selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return controls.right <= r.left || controls.left >= r.right || controls.bottom <= r.top || controls.top >= r.bottom;
        });
      })()`), true, 'session controls do not cover resources or the minimap');
      const tap = async ({ x, y }) => {
        assert.ok(x >= 0 && x <= width && y >= 0 && y <= height, 'touch target fits viewport');
        // Queue both events without a rendering round trip that could turn a tap into a hold.
        await Promise.all([
          page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
          page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
        ]);
      };
      const tapButton = async (text) => {
        const target = await evaluate(`(() => {
          const scope = document.querySelector('dialog[open]') ?? document;
          const el = [...scope.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)});
          if (scope !== document) el.scrollIntoView({block: 'nearest'});
          const r = el.getBoundingClientRect();
          return {x: r.x + r.width / 2, y: r.y + r.height / 2};
        })()`);
        await tap(target);
      };
      await tap(await evaluate(`(() => {
        const worker = window.__vd.read().units.find(u => u.owner === 1);
        return window.__vd.project(worker.x, worker.y);
      })()`));
      await wait(`document.querySelector('.card')?.textContent.includes(${JSON.stringify(pt ? 'Engenheiro' : 'Engineer')})`, 'touch selects worker');
      await screenshot('touch-selection');
      await tapButton(label.pause);
      await wait('document.querySelector("dialog[open]")', 'touch opens pause');
      const paused = await evaluate('window.__vd.read()');
      await delay(500);
      assert.deepEqual(await evaluate('window.__vd.read()'), paused);
      await screenshot('touch-paused');
      await tapButton(label.resume);
      await wait(`window.__vd.read().tick > ${paused.tick}`, 'touch resumes');
      await tapButton(label.pause);
      await tapButton(label.restart);
      await wait('window.__vd.read().tick < 20 && !document.querySelector("dialog[open]")', 'touch restarts');
      await tapButton(label.pause);
      await tapButton(label.menu);
      await wait('!window.__vd && document.querySelector(".menu")', 'touch returns to menu');
      assert.deepEqual(page.errors, []);
      console.log(`PASS ${name}: touch selection, pause, resume, restart, menu`);
      return;
    }
    await button(label.stop);
    await wait(`document.querySelector('.refusal')?.textContent.includes(${JSON.stringify(pt ? 'Selecione' : 'Select')})`, 'no-selection feedback');
    await wait('window.__vd.read().ore >= 250', 'ore for a barracks and two riflemen');

    // Real pointer selection and placement, with projection supplied by the existing localhost test hook.
    const bounds = await evaluate(`(() => {
      const p = window.__vd.read().units.filter(u => u.owner === 1).map(u => window.__vd.project(u.x, u.y));
      return {left: Math.min(...p.map(p => p.x))-20, right: Math.max(...p.map(p => p.x))+20,
        top: Math.min(...p.map(p => p.y))-30, bottom: Math.max(...p.map(p => p.y))+30};
    })()`);
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.left, y: bounds.top, button: 'left', clickCount: 1 });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.right, y: bounds.bottom, button: 'left', buttons: 1 });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.right, y: bounds.bottom, button: 'left', clickCount: 1 });
    await wait(`document.querySelector('.card')?.textContent.includes(${JSON.stringify(pt ? 'Engenheiro' : 'Engineer')})`, 'workers selected');
    await button(label.build);
    await button(label.barracks);
    await click(await point(10, 98));
    await wait('window.__vd.read().reason === "footprint"', 'occupied placement rejected');
    await click(await point(12.5, 90.5));
    await wait('window.__vd.read().buildings.some(b => b.owner === 1 && b.kind === "barracks")', 'legal construction accepted');
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    // Click the roof: workers moving along the footprint take priority at ground level.
    const barracksRoof = await point(13.5, 91.5);
    await click({ x: barracksRoof.x, y: barracksRoof.y - 35 });
    await wait('document.querySelector(".production progress")', 'construction progress visible');
    await button(label.rifle);
    await button(label.rifle);
    await wait('document.querySelector(".production ol li")', 'waiting production visible');
    await screenshot('production');
    console.log(`  ${name}: construction and production visible`);

    await button(label.pause);
    await wait('document.querySelector("dialog[open]")', 'pause dialog');
    const paused = await evaluate('window.__vd.read()');
    await delay(500);
    assert.deepEqual(await evaluate('window.__vd.read()'), paused, 'paused world must remain unchanged');
    await screenshot('paused');
    await checkExport();
    await button(label.resume);
    await wait(`window.__vd.read().tick > ${paused.tick}`, 'resume steps');
    await wait('window.__vd.read().units.filter(u => u.owner === 1 && u.kind === "rifleman").length === 2', 'two riflemen produced');
    await button(label.pause);
    await button(label.restart);
    await wait('window.__vd.read().tick < 20 && window.__vd.read().units.filter(u => u.owner === 1).length === 4 && !window.__vd.read().buildings.some(b => b.owner === 1 && b.kind === "barracks")', 'restart resets match');
    await button(label.pause);
    await button(label.menu);
    await wait('!window.__vd && document.querySelector(".menu")', 'return to title disposes field');

    await button(label.start);
    await wait('window.__vd && document.querySelector(".commands input")', 'new skirmish');
    // Restore deterministic, complete matches through the player's file input, not a fabricated winner.
    await loadReplay(resolve('apps/game/public/replays/reference-varek.json'));
    await wait(`document.querySelector('dialog[open] h2')?.textContent === ${JSON.stringify(label.victory)}`, 'victory panel');
    await checkExport();
    await screenshot('victory');
    await button(label.again);
    await wait('window.__vd.read().winner === 0 && window.__vd.read().tick < 20', 'play again');
    await loadReplay(join(work, 'defeat.json'));
    await wait(`document.querySelector('dialog[open] h2')?.textContent === ${JSON.stringify(label.defeat)}`, 'defeat panel');
    await screenshot('defeat');
    assert.equal(await evaluate(`(() => {
      const dialog = document.querySelector('dialog[open]');
      const r = dialog.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    })()`), true, 'result dialog fits viewport');
    await button(label.menu);
    await wait('document.querySelector(".menu") && !window.__vd', 'finished match returns to menu');
    assert.deepEqual(page.errors, [], 'no uncaught browser exceptions');
    console.log(`PASS ${name}: opening, rejection, construction, queue, pause, replay export, restart, victory, defeat, menu`);
  } catch (error) {
    if (page) {
      const capture = await page.call('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (capture) await writeFile(join(artifacts, `${name}-failure.png`), Buffer.from(capture.data, 'base64'));
      await writeFile(join(artifacts, `${name}-errors.json`), JSON.stringify(page.errors, null, 2));
    }
    throw error;
  } finally {
    page?.close();
    await stop(browser);
  }
}

try {
  await until(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, 'preview server');
  for (const language of ['en-US', 'pt-BR']) {
    for (const [width, height] of [[1280, 720], [1920, 1080]]) await run(language, width, height);
  }
  for (const [width, height] of [[360, 800], [844, 390]]) await run('pt-BR', width, height, true);
} finally {
  await stop(server);
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
