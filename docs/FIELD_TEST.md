# Multiplayer field test

Milestone 7 stays open until this test has been played by two people on different networks. One of those networks should be a mobile connection. A session on one machine, below, only checks that the match can finish. It does not close the milestone.

## What a passing session shows

- Both players reach the field.
- The match ends because a command center was destroyed, not because a page was closed.
- Each screen says Victory or Defeat for its own seat.
- Each screen then says the result was verified, or that it was not.
- Each player copies the diagnostics note. The two notes name the same audit result.

## How to play it

1. Both people open the same build. For a pull request, that is the preview named in the pull request. After it is on main, it is https://gamestudio42.github.io/void-dominion/ .
2. One person chooses **Host an online match** and copies the link. The link has `#join=` in it. Send the link in a chat message. Do not publish it.
3. The other person opens that link. The fragment is dropped after the join, so a reload does not join again.
4. Play a normal skirmish until one command center falls. Mine, build a barracks, train riflemen, and attack the other base. Engineers do not damage buildings, so the match does not end on its own.
5. When the banner appears, wait for the line under it. **Result verified** means the guest replayed the host's file and the checksum matched, including the guest's own orders. **Result not verified** means it did not. Both screens show the same verdict. The host learns it from the guest's report.
6. On each screen, press **Copy diagnostics** (or select the note and copy it) and paste both notes into the report.

If the join fails, the page says the two networks could not reach each other. That is the expected result when both sides are behind carrier-grade NAT. There is no relay. Write that down; it is a useful result, not a crash. A TURN server is only worth adding if this happens often.

A guest cannot reconnect, and a guest who leaves does not forfeit. The host pauses while the guest is gone. Closing the host's page ends the match for the guest.

## What to write down

Paste the two diagnostics notes unchanged. Then add:

- date and roughly where each person was (home, mobile data, same wifi);
- whether the join succeeded, and about how long it took;
- who won, and whether both screens agreed;
- anything the note does not say: a page reload, a laptop sleeping, a broker error.

The note looks like this:

```text
void-dominion field test
role: guest
tick: 4102
ping_ms: 86
ice_local: srflx
ice_remote: host
drops: 0
audit: pass
result: defeat
```

| Field | Meaning |
| --- | --- |
| `ping_ms` | Last round trip. `none` means no pong came back. |
| `ice_local` / `ice_remote` | How this browser reached the other. `host` is a local address, `srflx` is a public address from STUN, `prflx` is an address learned from the other side, `relay` would be a TURN server (this build has none). `unknown` means stats were not ready. |
| `drops` | Times the connection reported disconnected or failed. |
| `audit` | `pending` while the match is running, `pass` when the guest's replay matched, `fail` plus a reason when it did not. |
| `result` | `playing`, `victory`, `defeat`, or `draw`, from this seat. |

## One machine, 2026-11-14

This session is not the field test. Two headless Chrome windows on one computer joined through the public brokers and WebRTC. The host then issued ordinary commands: it built a barracks, trained riflemen, and sent them to open ground beside the other command center. That command center fell. `node tools/field-session.mjs` against the dev server is the script; it is not part of CI.

- Join: 6.7 s from the host button until both fields were up.
- Match: 102.3 s from there until both notes showed a finished audit.
- Tick 2053 on both sides. The host's result was victory and the guest's was defeat. Both audits passed. Ping was 39 ms on the host and 87 ms on the guest. Both ICE ends were `host`, the local address, which is what one computer should see. Drops were 0. A session across networks is the one that can show `srflx`.

Host:

```text
void-dominion field test
role: host
tick: 2053
ping_ms: 39
ice_local: host
ice_remote: host
drops: 0
audit: pass
result: victory
```

Guest:

```text
void-dominion field test
role: guest
tick: 2053
ping_ms: 87
ice_local: host
ice_remote: host
drops: 0
audit: pass
result: defeat
```

This does not close milestone 7.
