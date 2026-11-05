# Benchmarks

`pnpm bench` plays each comparable seed of the headless arena to its end and times every step. It prints the table below. With `--json` it prints the same rows as JSON, and `--runs N` sets the runs per seed (default 5). One warm-up match per seed is not counted.

Wall time is read only by `tools/bench/arena.ts`. The simulation never reads a clock, and the checksums in the table are the ones `pnpm sim` pins.

## Speed table

Measured on 2026-11-05: Intel Core i7-13620H, 16 threads, Node v22.23.4, 10 runs per seed. Load average at the start: 1.23 / 4.85 / 5.16 (1, 5 and 15 minutes).

| Seed | Ticks | Checksum | Match (ms) | Step mean (µs) | p50 (µs) | p95 (µs) | max (µs) | × real time |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| 0x5eed | 3333 | 1794058122 | 311 | 93 | 79 | 121 | 3550 | 536 |
| 0x51eed | 3333 | 2673108699 | 301 | 90 | 79 | 114 | 2839 | 554 |
| 0xa11ce | 3333 | 1865163346 | 300 | 90 | 78 | 115 | 2869 | 555 |

- **Match** is the mean wall time of one full unattended match, about 167 s of game time at 20 Hz.
- **× real time** is the 50 ms tick budget divided by the mean step.
- The slowest step, under 4 ms, still leaves more than 90% of the 50 ms budget.
- The rare slow steps are not attributed yet. Path searches and garbage collection are the likely causes.

## What the table does not cover

- The renderer, the React interface and the browser are not timed. A frame budget needs a real GPU, and that is a separate session.
- The unattended match has two bases and few units. A larger army or a longer match can cost more per step.
- No network match exists yet, so there is no latency or bandwidth figure.
- Numbers from another machine or a loaded one are not comparable to this table. Record the machine line with them.
