#!/usr/bin/env bash
# selftest.sh — prove the asset pipeline works on this machine before trusting
# it with a real asset. Builds examples/impact_burst.build.json, renders it,
# verifies alpha, and prints the measured numbers.
#
# Usage: tools/asset-pipeline/selftest.sh [--keep]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STAGING="${SELFTEST_STAGING:-$REPO/assets/_staging/_selftest}"

KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

cleanup() { [ "$KEEP" = "1" ] || rm -rf "$STAGING"; }
trap cleanup EXIT

printf 'effectcraft  %s\n' "$(command -v effectcraft-cli || echo MISSING)"
printf 'ffmpeg       %s\n' "$(command -v ffmpeg || echo MISSING)"
printf 'python3      %s\n\n' "$(command -v python3 || echo MISSING)"

"$HERE/bake.sh" \
  --asset _selftest \
  --comp impact_burst \
  --build "$HERE/examples/impact_burst.build.json" \
  --duration 0.6 --fps 30 \
  --staging "$STAGING"

"$HERE/bake.sh" \
  --asset _selftest \
  --comp impact_burst \
  --project "$STAGING/_selftest/_selftest.ecproj" \
  --duration 0.6 --fps 30 \
  --staging "$STAGING"

printf '\nmanifest\n'
"${PYTHON:-python3}" - "$STAGING/_selftest/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for e in m["exports"]:
    ex, a = e["export"], e["alpha"]
    print(f"  {ex['kind']:9} {ex['codec']:5} {ex['width']}x{ex['height']} {ex['frames']}f "
          f"{ex['bytes']:>8}B  peak {a['peak_coverage_pct']}% @{a['peak_time_s']}s  "
          f"last {a['last_frame_coverage_pct']}%  {e['verdict']}")
print(f"  overall {m['verdict']}  tool {m['tool']['version']}")
PY

printf '\nselftest: pipeline OK\n'
