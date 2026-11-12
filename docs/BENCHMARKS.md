# Benchmarks

`pnpm bench` plays each comparable seed of the headless arena to its end and times every step. It prints the table below. With `--json` it prints the same rows as JSON, and `--runs N` sets the runs per seed (default 5). One warm-up match per seed is not counted.

Wall time is read only by `tools/bench/arena.ts`. The simulation never reads a clock, and the checksums in the table are the ones `pnpm sim` pins.

## Speed table

Measured on 2026-11-05: Intel Core i7-13620H, 16 threads, Node v22.23.4, 10 runs per seed. Load average at the start: 1.23 / 4.85 / 5.16 (1, 5 and 15 minutes).

| Seed | Ticks | Checksum | Match (ms) | Step mean (µs) | p50 (µs) | p95 (µs) | max (µs) | × real time |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| 0x5eed | 3338 | 3280354694 | 311 | 93 | 79 | 121 | 3550 | 536 |
| 0x51eed | 3338 | 2653787263 | 301 | 90 | 79 | 114 | 2839 | 554 |
| 0xa11ce | 3338 | 3889541598 | 300 | 90 | 78 | 115 | 2869 | 555 |

The tick and checksum columns moved on 2026-11-12, when squads stopped sharing one cell. The timing columns are still the 2026-11-05 measurement.

- **Match** is the mean wall time of one full unattended match, about 167 s of game time at 20 Hz.
- **× real time** is the 50 ms tick budget divided by the mean step.
- The slowest step, under 4 ms, still leaves more than 90% of the 50 ms budget.
- The rare slow steps are not attributed yet. Path searches and garbage collection are the likely causes.

## Client view

`pnpm bench:view [--army N]` measures the view a multiplayer host sends its guest (`docs/MULTIPLAYER.md`). It takes one view per seat every second tick. There are two scenarios:
- the unattended skirmish;
- a fight between two blocks of riflemen in the middle of the map, in sight of both. The default is 100 a side; `--army 200` sets 200.

Measured on 2026-11-05 on the same machine, under a load average of 9 to 12 from other work. The timing columns are therefore pessimistic; the byte columns do not depend on load.

| Scenario | Max entities | JSON mean (B) | JSON p95 (B) | JSON max (B) | gzip mean (B) | gzip max (B) | Build mean (µs) | Build p95 (µs) | gzip mean (µs) | Raw at 10 Hz (KB/s) | gzip at 10 Hz (KB/s) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Unattended 0x5eed | 23 | 1696 | 3079 | 3670 | 469 | 823 | 197 | 394 | 88 | 16.6 | 4.6 |
| Stress, 100 riflemen a side | 145 | 15448 | 16537 | 16597 | 1119 | 1236 | 419 | 963 | 251 | 150.9 | 10.9 |
| Stress, 200 riflemen a side | 245 | 27728 | 28827 | 28887 | 1549 | 1667 | 724 | 1282 | 510 | 270.8 | 15.1 |

- **Max entities** is the most units and buildings in one view. The armies fight, so it stays below the number spawned.
- **Rates** assume one view per seat 10 times a second. Gzip stands in for the browser's `deflate-raw`.

## What the table does not cover

- The renderer, the React interface and the browser are not timed. A frame budget needs a real GPU, and that is a separate session.
- The unattended match has two bases and few units. A larger army or a longer match can cost more per step.
- No network match exists yet. The view table gives the bandwidth a host would need, but there is no latency figure.
- Numbers from another machine or a loaded one are not comparable to this table. Record the machine line with them.
