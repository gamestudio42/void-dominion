/* global process, fetch, WebSocket, console */
/**
 * One-machine check of an online match through the public brokers and WebRTC.
 * Not the cross-network field test, and not part of CI: it needs Chrome and the brokers.
 *
 *   node tools/field-session.mjs
 *   FIELD_URL=http://127.0.0.1:5173 node tools/field-session.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const URL = process.env.FIELD_URL ?? 'http://127.0.0.1:5173/';
/** The PATH wrapper forces one shared profile and one debug port. Call the binary. */
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
const JOIN_MS = 60_000;
const MATCH_MS = 6 * 60_000;

function launch(port, userData, url) {
  return spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--window-size=1280,800',
    url,
  ], { stdio: 'ignore' });
}

async function debuggerPage(port) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still opening its port.
    }
    await delay(200);
  }
  throw new Error(`Chrome on port ${port} did not open a page`);
}

function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let next = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('devtools socket failed')));
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const wait = pending.get(message.id);
    if (!wait) return;
    pending.delete(message.id);
    wait(message);
  });
  return {
    async call(method, params = {}) {
      await opened;
      const id = ++next;
      const result = new Promise((resolve) => pending.set(id, resolve));
      ws.send(JSON.stringify({ id, method, params }));
      const message = await result;
      if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
      return message.result;
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(page, expression) {
  const result = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(text);
  }
  return result.result.value;
}

async function waitFor(page, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(page, expression);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const hostDir = await mkdtemp(join(tmpdir(), 'vd-host-'));
const guestDir = await mkdtemp(join(tmpdir(), 'vd-guest-'));
const hostChrome = launch(9222, hostDir, URL);
const guestChrome = launch(9333, guestDir, 'about:blank');

try {
  const host = session(await debuggerPage(9222));
  const guest = session(await debuggerPage(9333));
  const joinedAt = Date.now();
  const clicked = await waitFor(host, `(() => {
    const button = [...document.querySelectorAll('button')].find((el) => /host an online match|hospedar partida/i.test(el.textContent ?? ''));
    if (!button) return false;
    button.click();
    return true;
  })()`, 15_000, 'the host button');
  if (!clicked) throw new Error('host button was not clicked');
  const link = await waitFor(host, `(() => {
    const input = document.querySelector('input[readonly]');
    return input && String(input.value).includes('#join=') ? input.value : '';
  })()`, 20_000, 'the match link');
  await guest.call('Page.navigate', { url: link });
  await waitFor(host, `(() => window.__vd && document.querySelector('.diagnostics textarea') ? true : false)`, JOIN_MS, 'the host field');
  await waitFor(guest, `(() => {
    const box = document.querySelector('.diagnostics textarea');
    return box && box.value.includes('role: guest') ? true : false;
  })()`, JOIN_MS, 'the guest field');
  const fieldAt = Date.now();
  console.error(`field ready in ${((fieldAt - joinedAt) / 1000).toFixed(1)}s`);

  const drive = `(async () => {
    const vd = window.__vd;
    if (!vd) return 'no drive';
    const read = () => vd.read();
    const order = (cmd) => vd.order(cmd);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const engineers = () => read().units.filter((unit) => unit.owner === 1 && unit.kind === 'engineer');
    const rifles = () => read().units.filter((unit) => unit.owner === 1 && unit.kind === 'rifleman');
    const barracks = () => read().buildings.find((building) => building.owner === 1 && building.kind === 'barracks');
    const until = Date.now() + ${MATCH_MS - 30_000};
    while (Date.now() < until && read().ore < 150) await sleep(200);
    if (read().ore < 150) return 'ore stayed at ' + read().ore;
    const sites = [[4, 92], [12, 90], [18, 94], [4, 88], [20, 96], [8, 88]];
    let placed = false;
    let buildReason = '';
    for (const [x, y] of sites) {
      const builder = engineers()[0];
      if (!builder) return 'no engineer';
      order({ type: 'build', playerId: 1, unitIds: [builder.id], kind: 'barracks', at: { x, y } });
      await sleep(400);
      buildReason = read().reason ?? '';
      if (buildReason) continue;
      placed = true;
      break;
    }
    if (!placed) return 'build refused ' + buildReason;
    for (let n = 0; n < 160 && !barracks(); n++) await sleep(250);
    if (!barracks()) return 'no barracks';
    let produced = 0;
    let marched = 0;
    while (Date.now() < until && read().winner === 0) {
      const hall = barracks();
      if (hall && rifles().length < 6 && read().ore >= 50) {
        order({ type: 'produce', playerId: 1, buildingId: hall.id, kind: 'rifleman' });
        await sleep(350);
        if (!read().reason) produced += 1;
      }
      const army = rifles();
      if (army.length >= 4) {
        order({ type: 'attack_move', playerId: 1, unitIds: army.map((unit) => unit.id), to: { x: 111, y: 28 } });
        await sleep(350);
        if (!read().reason) marched = army.length;
      }
      await sleep(800);
    }
    return JSON.stringify({ winner: read().winner, tick: read().tick, rifles: rifles().length, produced, marched, reason: read().reason });
  })()`;

  const driving = evaluate(host, drive);
  const noteOf = (page) => evaluate(page, `document.querySelector('.diagnostics textarea')?.value ?? ''`);
  let driven = '';
  while (!driven) {
    const step = await Promise.race([
      driving.then((value) => ({ kind: 'done', value })),
      delay(15_000).then(() => ({ kind: 'wait' })),
    ]);
    if (step.kind === 'done') {
      driven = step.value;
      break;
    }
    const guestNote = await noteOf(guest).catch((error) => String(error));
    console.error(`t+${((Date.now() - fieldAt) / 1000).toFixed(0)}s ${guestNote.split('\n').slice(0, 6).join(' | ')}`);
  }
  console.error(`drive: ${driven}`);

  const finished = `(() => {
    const box = document.querySelector('.diagnostics textarea');
    if (!box) return '';
    const text = box.value;
    if (!/audit: (pass|fail)/.test(text)) return '';
    if (!/result: (victory|defeat|draw)/.test(text)) return '';
    return text;
  })()`;
  const hostNote = await waitFor(host, finished, 30_000, 'the host audit');
  const guestNote = await waitFor(guest, finished, 30_000, 'the guest audit');
  const endedAt = Date.now();
  console.log(JSON.stringify({
    joinSeconds: Number(((fieldAt - joinedAt) / 1000).toFixed(1)),
    matchSeconds: Number(((endedAt - fieldAt) / 1000).toFixed(1)),
    drive: driven,
    host: hostNote,
    guest: guestNote,
  }, null, 2));
  host.close();
  guest.close();
} finally {
  hostChrome.kill('SIGKILL');
  guestChrome.kill('SIGKILL');
  await rm(hostDir, { recursive: true, force: true }).catch(() => {});
  await rm(guestDir, { recursive: true, force: true }).catch(() => {});
}
