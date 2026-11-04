#!/usr/bin/env bash
# bake_mesh.sh — low-poly mesh from a JSON spec: generate → export GLB → verify
# → manifest → review atlas. Same contract as the ArtCraft pipeline: nothing
# leaves staging until verify_glb.py passes.
#
# Usage:
#   bake_mesh.sh --spec FILE [options]
#
#   --spec FILE       part spec for generate_lowpoly.py (required)
#   --asset NAME      asset name (default: spec "name")
#   --out DIR         output dir (default: spec "out", else assets/_staging/NAME)
#   --max-tris N      budget override (default: spec "tri_budget")
#   --no-atlas        skip the turntable renders
#   --staging DIR     staging root (default assets/_staging)
#
# Exit: 0 when generation and verification both pass.
set -euo pipefail

PY="${PYTHON:-python3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BLENDER="${BLENDER:-$(command -v blender || true)}"

die() { printf 'bake_mesh: %s\n' "$*" >&2; exit 2; }

SPEC=""; ASSET=""; OUT=""; MAXTRIS=""; ATLAS=1; STAGING="$REPO/assets/_staging"
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC="${2:-}"; shift 2 ;;
    --asset) ASSET="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --max-tris) MAXTRIS="${2:-}"; shift 2 ;;
    --no-atlas) ATLAS=0; shift ;;
    --staging) STAGING="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$SPEC" ] || die "missing --spec FILE"
[ -f "$SPEC" ] || die "spec not found: $SPEC"
[ -n "$BLENDER" ] || die "blender not found (snap install blender, or set BLENDER=/path)"

BLENDER_VERSION="$("$BLENDER" --version 2>/dev/null | head -1)"
export BLENDER_VERSION

read -r ASSET_SPEC OUT_SPEC BUDGET_SPEC < <("$PY" - "$SPEC" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
print(s.get("name") or "", s.get("out") or "", s.get("tri_budget") or 0)
PY
)
ASSET="${ASSET:-$ASSET_SPEC}"
[ -n "$ASSET" ] || die "no asset name in spec; pass --asset"
OUT="${OUT:-${OUT_SPEC:-$STAGING/$ASSET}}"
MAXTRIS="${MAXTRIS:-$BUDGET_SPEC}"
mkdir -p "$OUT"

BLENDER_ARGS=(-b --factory-startup -P "$HERE/generate_lowpoly.py" -- --spec "$SPEC" --out "$OUT")
[ "$ATLAS" = "1" ] || BLENDER_ARGS+=(--no-atlas)

printf 'blender    %s\n' "$BLENDER_VERSION"
printf 'spec       %s\n' "$SPEC"
START=$(date +%s)
if ! "$BLENDER" "${BLENDER_ARGS[@]}" >"$OUT/.blender.log" 2>&1; then
  tail -30 "$OUT/.blender.log" >&2
  die "blender failed, see $OUT/.blender.log"
fi
ELAPSED=$(( $(date +%s) - START ))
grep -E "^METRICS |^BUDGET_EXCEEDED" "$OUT/.blender.log" || true
printf 'generated  %ss → %s/%s.glb\n' "$ELAPSED" "$OUT" "$ASSET"

VERIFY_ARGS=("$OUT/$ASSET.glb" --asset "$ASSET" --manifest "$OUT/manifest.json" --json)
[ -n "$MAXTRIS" ] && [ "$MAXTRIS" != "0" ] && VERIFY_ARGS+=(--max-tris "$MAXTRIS")
VERDICT=0
"$PY" "$HERE/verify_glb.py" "${VERIFY_ARGS[@]}" || VERDICT=1

# Review artifacts: a strip and a turntable GIF, built with ffmpeg when present.
FFMPEG="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
if [ "$ATLAS" = "1" ] && [ -n "$FFMPEG" ] && [ -d "$OUT/frames" ]; then
  "$FFMPEG" -v error -y -framerate 8 -i "$OUT/frames/view_%03d.png" \
    -vf "tile=8x1" -frames:v 1 -pix_fmt rgba "$OUT/atlas.png" || true
  "$FFMPEG" -v error -y -framerate 8 -i "$OUT/frames/view_%03d.png" \
    -loop 0 -pix_fmt rgba "$OUT/turntable.gif" || true
  printf 'review     %s/atlas.png  %s/turntable.gif\n' "$OUT" "$OUT"
fi

[ "$VERDICT" = "0" ] || { printf 'bake_mesh: verification failed — do not ship %s\n' "$ASSET" >&2; exit 1; }
printf 'bake_mesh: %s OK  manifest %s/manifest.json\n' "$ASSET" "$OUT"
