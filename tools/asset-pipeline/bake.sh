#!/usr/bin/env bash
# bake.sh — build one asset from a versioned .ecproj, render it, verify it, and
# write the manifest. Nothing leaves staging until verify_export.sh passes.
#
# Usage:
#   bake.sh --asset NAME --comp COMP [options]
#
#   --asset NAME        asset name; staging dir assets/_staging/NAME (required)
#   --comp COMP         composition name inside the project (required)
#   --project FILE      existing .ecproj to render from
#   --build FILE        JSON array of {command, params} steps; baked into
#                       assets/_staging/NAME/NAME.ecproj before rendering
#   --duration S        render length in seconds (default: comp work area)
#   --fps N             frame rate (default 30)
#   --staging DIR       staging root (default assets/_staging)
#   --no-preview        skip the WebM preview (sequence only)
#   --draft             render the preview at draft quality (default)
#
# Exit: 0 when every rendered export passes verification.
set -euo pipefail

PY="${PYTHON:-python3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

ASSET=""; COMP=""; PROJECT=""; BUILD=""; DURATION=""; FPS=30
STAGING="$REPO/assets/_staging"; PREVIEW=1; QUALITY=draft

die() { printf 'bake: %s\n' "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --asset) ASSET="${2:-}"; shift 2 ;;
    --comp) COMP="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --build) BUILD="${2:-}"; shift 2 ;;
    --duration) DURATION="${2:-}"; shift 2 ;;
    --fps) FPS="${2:-}"; shift 2 ;;
    --staging) STAGING="${2:-}"; shift 2 ;;
    --no-preview) PREVIEW=0; shift ;;
    --draft) QUALITY=draft; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$ASSET" ] || die "missing --asset NAME"
[ -n "$COMP" ] || die "missing --comp COMP"
command -v effectcraft-cli >/dev/null || die "effectcraft-cli not on PATH (~/.local/bin)"

EFFECTCRAFT_VERSION="$(effectcraft-cli --version 2>/dev/null | awk '{print $2}')"
export EFFECTCRAFT_VERSION

OUT_DIR="$STAGING/$ASSET"
PROJECT_PATH="${PROJECT:-$OUT_DIR/$ASSET.ecproj}"
mkdir -p "$OUT_DIR/frames"

# 1. Build: turn the recipe into a project file, one process, all steps.
if [ -n "$BUILD" ]; then
  [ -f "$BUILD" ] || die "build file not found: $BUILD"
  mkdir -p "$OUT_DIR"
  WRAPPED="$OUT_DIR/.build.wrapped.json"
  "$PY" - "$BUILD" "$WRAPPED" "$OUT_DIR/$ASSET.ecproj" <<'PY'
import json, sys
src, dest, project = sys.argv[1:4]
steps = json.load(open(src))
if isinstance(steps, dict):
    steps = [steps]
if not any((s.get("command") or s.get("id")) == "file.saveAs" for s in steps):
    steps.append({"command": "file.saveAs", "params": {"path": project}})
json.dump(steps, open(dest, "w"), indent=1)
print(f"steps      {len(steps)}", file=sys.stderr)
PY
  printf 'build      %s (%s steps)\n' "$BUILD" "$("$PY" -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$WRAPPED")"
  effectcraft-cli run --commands "$WRAPPED" >"$OUT_DIR/.build.log" 2>&1 \
    || { tail -20 "$OUT_DIR/.build.log" >&2; die "build failed, see $OUT_DIR/.build.log"; }
  PROJECT_PATH="$OUT_DIR/$ASSET.ecproj"
fi

[ -f "$PROJECT_PATH" ] || die "project not found: $PROJECT_PATH (pass --build or --project)"

# 2. Render the delivery artifact: PNG sequence, alpha preserved.
RENDER_ARGS=(render --comp "$COMP" --format png --channels rgba --fps "$FPS"
             --out "$OUT_DIR/frames/f.png" "$PROJECT_PATH")
[ -n "$DURATION" ] && RENDER_ARGS+=(--start 0 --end "$DURATION")
printf 'render     png sequence → %s/frames\n' "$OUT_DIR"
effectcraft-cli "${RENDER_ARGS[@]}" >"$OUT_DIR/.render-png.log" 2>&1 \
  || { tail -20 "$OUT_DIR/.render-png.log" >&2; die "png render failed"; }
tail -1 "$OUT_DIR/.render-png.log"

# 3. Render the review artifact: WebM VP9 with alpha, for humans and browsers.
if [ "$PREVIEW" = "1" ]; then
  PREVIEW_ARGS=(render --comp "$COMP" --format webm --channels rgba --webm-codec vp9
                --quality "$QUALITY" --fps "$FPS" --out "$OUT_DIR/$ASSET.webm" "$PROJECT_PATH")
  [ -n "$DURATION" ] && PREVIEW_ARGS+=(--start 0 --end "$DURATION")
  effectcraft-cli "${PREVIEW_ARGS[@]}" >"$OUT_DIR/.render-webm.log" 2>&1 \
    || { tail -20 "$OUT_DIR/.render-webm.log" >&2; die "webm preview failed"; }
  tail -1 "$OUT_DIR/.render-webm.log"
fi

# 4. Verify by decoding pixels; the manifest is written only for real exports.
VERDICT=0
"$HERE/verify_export.sh" "$OUT_DIR/frames" --asset "$ASSET" --fps "$FPS" \
  --source "$PROJECT_PATH" --out "$OUT_DIR/manifest.json" || VERDICT=1
if [ "$PREVIEW" = "1" ]; then
  "$HERE/verify_export.sh" "$OUT_DIR/$ASSET.webm" --asset "$ASSET" --fps "$FPS" \
    --source "$PROJECT_PATH" --out "$OUT_DIR/manifest.json" || VERDICT=1
fi

printf 'manifest   %s\n' "$OUT_DIR/manifest.json"
[ "$VERDICT" = "0" ] || { printf 'bake: verification failed — do not ship %s\n' "$ASSET" >&2; exit 1; }
printf 'bake: %s OK (effectcraft %s)\n' "$ASSET" "$EFFECTCRAFT_VERSION"
