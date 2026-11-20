import type { ObserveRequest } from '@void-dominion/agent-sdk';
import { MATCH } from '@void-dominion/content';
import { varekLevel, type SeatControl, type Seats } from '@void-dominion/simulation';
import { useEffect, useRef, useState } from 'react';
import { actionsForObservation } from '../../../examples/deterministic.ts';
import { createMemory, decide as referenceDecide } from '../../../examples/reference.ts';
import { playLocalMatch, type LocalMatchResult, type LocalSeatAgent } from '../../../packages/arena/src/local-match.ts';
import {
  EXAMPLE_AGENT_SOURCE,
  LOCAL_DECISION_TIMEOUT_MS,
  agentSourceError,
  agentWorkerSource,
  askAgent,
  encodeReplayLink,
  type AgentEndpoint,
} from '../../../packages/arena/src/sandbox.ts';
import { messagesFor, type Messages } from './locales.ts';

/** The published doc. The game is a static page, so the markdown is not beside it. */
const HOW_TO = 'https://github.com/gamestudio42/void-dominion/blob/main/docs/AGENT_ARENA.md#write-an-agent';

type VarekOpponent = 'varek_easy' | 'varek' | 'varek_hard';
type Opponent = VarekOpponent | 'reference' | 'example';

function isVarek(kind: Opponent): kind is VarekOpponent {
  return kind === 'varek_easy' || kind === 'varek' || kind === 'varek_hard';
}

function spawn(code: string): Worker {
  const url = URL.createObjectURL(new Blob([agentWorkerSource(code)], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}

/** One worker for the player's script. A timeout terminates it, and the next decision starts a fresh one. */
class PageAgent {
  private worker: Worker | null = null;

  constructor(private readonly code: string) {}

  private endpoint(): AgentEndpoint {
    if (!this.worker) this.worker = spawn(this.code);
    const worker = this.worker;
    return {
      postMessage: (message) => worker.postMessage(message),
      terminate: () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      },
      listen: (onMessage, onError) => {
        const message = (event: MessageEvent) => onMessage(event.data);
        const error = (event: ErrorEvent) => onError(event.message || 'agent crashed');
        worker.addEventListener('message', message);
        worker.addEventListener('error', error);
        return () => {
          worker.removeEventListener('message', message);
          worker.removeEventListener('error', error);
        };
      },
    };
  }

  async act(observe: ObserveRequest): Promise<unknown[]> {
    const reply = await askAgent(this.endpoint(), observe, LOCAL_DECISION_TIMEOUT_MS);
    if (!reply.ok) throw new Error(reply.error);
    return reply.actions;
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

function opponentAgent(kind: Opponent, seat: 1 | 2): LocalSeatAgent | null {
  if (isVarek(kind)) return null;
  if (kind === 'reference') {
    const memory = createMemory();
    return { seat, act: (observe) => Promise.resolve(referenceDecide(observe, memory)) };
  }
  return { seat, act: (observe) => Promise.resolve(actionsForObservation(observe)) };
}

function outcome(text: Messages, seats: Seats, winner: number, ticks: number): string {
  const clock = text.tick(ticks);
  if (winner === 0) return `${text.replay_undecided} · ${clock}`;
  if (winner < 0) return `${text.replay_draw} · ${clock}`;
  const name = varekLevel(seats[winner - 1]!) ? text.replay_varek : text.replay_seat(winner);
  return `${text.replay_winner(name)} · ${clock}`;
}

export function ArenaPanel({ onBack, onWatch }: { onBack: () => void; onWatch: (replay: string) => void }) {
  const text = messagesFor(navigator.language);
  const fileRef = useRef<HTMLInputElement>(null);
  const agentRef = useRef<PageAgent | null>(null);
  const runId = useRef(0);
  const [code, setCode] = useState(EXAMPLE_AGENT_SOURCE);
  const [opponent, setOpponent] = useState<Opponent>('varek');
  const [seedText, setSeedText] = useState(String(MATCH.seed));
  const [seat, setSeat] = useState<1 | 2>(1);
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<LocalMatchResult | null>(null);
  const [linkNote, setLinkNote] = useState<'idle' | 'copied' | 'file'>('idle');

  useEffect(() => () => {
    runId.current += 1;
    agentRef.current?.stop();
  }, []);

  function describe(line: string): string {
    return line.includes('decision timed out') ? line.replace('decision timed out', text.arena_timeout) : line;
  }

  function seatsFor(kind: Opponent, playerSeat: 1 | 2): Seats {
    if (!isVarek(kind)) return ['human', 'human'];
    const varek: SeatControl = kind;
    return playerSeat === 1 ? ['human', varek] : [varek, 'human'];
  }

  async function play(): Promise<void> {
    const seed = Number(seedText);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      setProblem(text.arena_seed_invalid);
      return;
    }
    const syntax = agentSourceError(code);
    if (syntax) {
      setProblem(text.arena_syntax(syntax));
      return;
    }
    const id = runId.current + 1;
    runId.current = id;
    agentRef.current?.stop();
    const pageAgent = new PageAgent(code);
    agentRef.current = pageAgent;
    const otherSeat: 1 | 2 = seat === 1 ? 2 : 1;
    const agents: LocalSeatAgent[] = [{ seat, act: (observe) => pageAgent.act(observe) }];
    const other = opponentAgent(opponent, otherSeat);
    if (other) agents.push(other);
    setRunning(true);
    setResult(null);
    setProblem(null);
    setLinkNote('idle');
    setTick(0);
    try {
      const played = await playLocalMatch({
        seed,
        seats: seatsFor(opponent, seat),
        agents,
        onTick: (now) => {
          if (runId.current === id) setTick(now);
        },
        shouldStop: () => runId.current !== id,
      });
      if (runId.current !== id) return;
      setResult(played);
    } catch (error) {
      if (runId.current !== id) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message !== 'aborted') setProblem(message);
    } finally {
      if (runId.current === id) {
        pageAgent.stop();
        setRunning(false);
      }
    }
  }

  function leave(): void {
    runId.current += 1;
    agentRef.current?.stop();
    onBack();
  }

  function exportReplay(): void {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.replay], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `void-dominion-arena-${seedText}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyLink(): Promise<void> {
    if (!result) return;
    const encoded = await encodeReplayLink(result.replay);
    if (!encoded) {
      setLinkNote('file');
      return;
    }
    const url = `${location.origin}${location.pathname}?replay-data=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkNote('copied');
    } catch {
      setProblem(url);
    }
  }

  return (
    <>
      <p>{text.arena_lead}</p>
      <textarea
        className="arena-editor"
        value={code}
        spellCheck={false}
        aria-label={text.arena}
        onChange={(event) => setCode(event.target.value)}
      />
      <div className="arena-actions">
        <button type="button" onClick={() => fileRef.current?.click()}>{text.arena_load}</button>
        <a className="arena-doc" href={HOW_TO} target="_blank" rel="noreferrer">{text.arena_how}</a>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".js,text/javascript"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void file.text().then((body) => setCode(body));
        }}
      />
      <div className="arena-form">
        <label>
          {text.arena_opponent}
          <select value={opponent} disabled={running} onChange={(event) => setOpponent(event.target.value as Opponent)}>
            <option value="varek_easy">{text.arena_varek_easy}</option>
            <option value="varek">{text.arena_varek_normal}</option>
            <option value="varek_hard">{text.arena_varek_hard}</option>
            <option value="reference">{text.arena_reference}</option>
            <option value="example">{text.arena_example}</option>
          </select>
        </label>
        <label>
          {text.arena_seed}
          <input
            type="number"
            min={0}
            max={4294967295}
            value={seedText}
            disabled={running}
            onChange={(event) => setSeedText(event.target.value)}
          />
        </label>
        <label>
          {text.arena_seat}
          <select value={seat} disabled={running} onChange={(event) => setSeat(event.target.value === '2' ? 2 : 1)}>
            <option value={1}>{text.replay_seat(1)}</option>
            <option value={2}>{text.replay_seat(2)}</option>
          </select>
        </label>
      </div>
      <div className="arena-actions">
        <button type="button" disabled={running} onClick={() => void play()}>{text.arena_play}</button>
        <button type="button" onClick={leave}>{text.back}</button>
      </div>
      {running && <p>{text.arena_running(tick)}</p>}
      {problem && <p className="failure">{problem}</p>}
      {result && (
        <>
          <p>{text.arena_result(outcome(text, seatsFor(opponent, seat), result.winner, result.ticks), result.checksum)}</p>
          {result.errors.length > 0 && <pre className="arena-log">{result.errors.map(describe).join('\n')}</pre>}
          <div className="arena-actions">
            <button type="button" onClick={exportReplay}>{text.arena_export}</button>
            <button type="button" onClick={() => onWatch(result.replay)}>{text.arena_watch}</button>
            <button type="button" onClick={() => void copyLink()}>{linkNote === 'copied' ? text.arena_copied : text.arena_copy}</button>
          </div>
          {linkNote === 'file' && <p>{text.arena_file_only}</p>}
        </>
      )}
    </>
  );
}
