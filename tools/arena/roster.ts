/**
 * Agents measured by `pnpm arena:leaderboard`.
 * Append `{ id, script }` to add one. An entry without `script` is the in-process noop.
 * Ollama is not in this list. Set ARENA_LEADERBOARD_OLLAMA=1 to include it for one run.
 */

export interface RosterEntry {
  id: string;
  /** Path relative to the repository root. */
  script?: string;
}

export const LEADERBOARD_ROSTER: readonly RosterEntry[] = [
  { id: 'reference', script: 'examples/reference.ts' },
  { id: 'example', script: 'examples/deterministic.ts' },
  { id: 'noop' },
];

export function rosterForRun(includeOllama: boolean): RosterEntry[] {
  const roster = LEADERBOARD_ROSTER.map((entry) => ({ ...entry }));
  if (includeOllama) roster.push({ id: 'ollama', script: 'examples/ollama.ts' });
  return roster;
}
