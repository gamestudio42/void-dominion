#!/usr/bin/env bash
# verify_export.sh — prove a rendered export is actually usable before it ships.
#
# Decodes the alpha channel of a PNG frame sequence, a PNG still or an alpha
# video and reports per-frame coverage. Writes or merges manifest.json so a
# later tool upgrade can be diffed against what was really shipped.
#
# Usage:
#   verify_export.sh <target> --asset NAME [options]
#
#   <target>              PNG sequence directory, a single .png, or a video
#                         (.webm/.mov/.mkv) with an alpha channel
#   --asset NAME          logical asset name recorded in the manifest (required)
#   --out FILE            manifest path (default: <staging dir>/manifest.json)
#   --source FILE         .ecproj that produced the export (recorded)
#   --fps N               frame rate for a sequence directory (default 30)
#   --strict-ending       fail when the last frame still carries alpha
#   --json                print the manifest entry instead of a table
#
# Exit: 0 pass (or warn), 1 fail, 2 usage.
set -euo pipefail

PY="${PYTHON:-python3}"
FFMPEG_BIN="${FFMPEG_BIN:-}"
FFPROBE_BIN="${FFPROBE_BIN:-}"

die() { printf 'verify_export: %s\n' "$*" >&2; exit 2; }

find_tool() { # find_tool <name> <override>
  local name="$1" override="$2" found=""
  if [ -n "$override" ]; then printf '%s' "$override"; return; fi
  if found="$(command -v "$name" 2>/dev/null)"; then printf '%s' "$found"; return; fi
  found="$(ls -1 "$HOME"/.hermes/tools/ffmpeg-*/bin/"$name" 2>/dev/null | head -1 || true)"
  [ -n "$found" ] || die "$name not found (set FFMPEG_BIN/FFPROBE_BIN)"
  printf '%s' "$found"
}

TARGET=""; ASSET=""; OUT=""; SRC=""; FPS=30; STRICT=0; JSON_OUT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --asset) ASSET="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --source) SRC="${2:-}"; shift 2 ;;
    --fps) FPS="${2:-}"; shift 2 ;;
    --strict-ending) STRICT=1; shift ;;
    --json) JSON_OUT=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || die "missing <target>"
[ -e "$TARGET" ] || die "target does not exist: $TARGET"
[ -n "$ASSET" ] || die "missing --asset NAME"

FFMPEG="$(find_tool ffmpeg "$FFMPEG_BIN")"
FFPROBE="$(find_tool ffprobe "$FFPROBE_BIN")"

# Resolve input for ffmpeg and remember what kind of export this is.
KIND=""; INPUT_ARGS=(); FIRST_FILE="$TARGET"
if [ -d "$TARGET" ]; then
  KIND="sequence"
  FIRST_FILE="$(ls -1 "$TARGET"/*.png 2>/dev/null | sort | head -1 || true)"
  [ -n "$FIRST_FILE" ] || die "no .png frames in $TARGET"
  COUNT="$(ls -1 "$TARGET"/*.png 2>/dev/null | wc -l | tr -d ' ')"
  INPUT_ARGS=(-framerate "$FPS" -pattern_type glob -i "$TARGET/*.png")
else
  case "$TARGET" in
    *.png) KIND="still" ;;
    *.webm) KIND="video-webm" ;;
    *.mov|*.mkv|*.avi|*.mp4) KIND="video" ;;
    *) KIND="other" ;;
  esac
  COUNT=1
  INPUT_ARGS=(-i "$TARGET")
fi

# Probe container/stream facts.
PROBE="$("$FFPROBE" -v error -select_streams v:0 \
  -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate \
  -show_entries format=duration \
  -of json "$FIRST_FILE")"

read -r W H CODEC PIX DUR < <("$PY" - "$PROBE" "$KIND" "$FPS" "$COUNT" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
kind, fps, count = sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
st = (d.get("streams") or [{}])[0]
w = int(st.get("width") or 0); h = int(st.get("height") or 0)
dur = 0.0
if kind == "sequence":
    dur = count / fps
else:
    try:
        dur = float((d.get("format") or {}).get("duration") or 0.0)
    except ValueError:
        dur = 0.0
print(w, h, st.get("codec_name") or "png", st.get("pix_fmt") or "rgba", f"{dur:.4f}")
PY
)
[ "${W:-0}" -gt 0 ] && [ "${H:-0}" -gt 0 ] || die "could not probe ${TARGET}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/verify-export.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
RAW="$TMP/alpha.raw"

DECODE=()
if [ "$KIND" = "video-webm" ]; then
  # VP9 alpha lives in BlockAdditions; only libvpx-vp9 decodes it.
  DECODE=(-c:v libvpx-vp9)
fi
"$FFMPEG" -v error -y "${DECODE[@]}" "${INPUT_ARGS[@]}" \
  -vf alphaextract -f rawvideo -pix_fmt gray "$RAW" || die "alpha decode failed for $TARGET"

if [ ! -s "$RAW" ]; then
  printf '{"asset":"%s","error":"alpha decode produced no pixels","verdict":"fail"}\n' "$ASSET"
  exit 1
fi

STATS="$("$PY" - "$RAW" "$W" "$H" "$FPS" "$KIND" <<'PY'
import json, sys
raw, w, h, fps = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4])
data = open(raw, "rb").read()
fs = w * h
n = len(data) // fs
if n == 0:
    print(json.dumps({"error": "no complete frame decoded"})); raise SystemExit
VISIBLE = 8  # alpha values below this are encoder noise, not a visible pixel
frames = []
for i in range(n):
    fr = data[i * fs:(i + 1) * fs]
    cover = 100.0 * sum(1 for x in fr if x >= VISIBLE) / fs
    frames.append((max(fr), cover))
mx = [f[0] for f in frames]; cov = [f[1] for f in frames]
peak = max(range(n), key=lambda i: cov[i])
dead = None
for i in range(peak, n):
    if mx[i] < VISIBLE and cov[i] == 0.0:
        dead = i / fps
        break
out = {
    "frames": n,
    "max_alpha": max(mx),
    "visible_frames": sum(1 for c in cov if c > 0.0),
    "peak_frame": peak,
    "peak_time_s": round(peak / fps, 4),
    "peak_coverage_pct": round(cov[peak], 4),
    "last_frame_max_alpha": mx[-1],
    "last_frame_coverage_pct": round(cov[-1], 4),
    "dead_after_s": None if dead is None else round(dead, 4),
    "coverage_pct_by_frame": [round(c, 3) for c in cov],
}
print(json.dumps(out))
PY
)"

MANIFEST="$("$PY" - "$STATS" "$TARGET" "$ASSET" "$SRC" "$W" "$H" "$FPS" "$COUNT" "$KIND" "$CODEC" "$PIX" "$DUR" "$STRICT" <<'PY'
import json, os, sys
(stats_s, target, asset, src, w, h, fps, count, kind, codec, pix, dur, strict) = sys.argv[1:14]
stats = json.loads(stats_s)
w, h, fps, count = int(w), int(h), float(fps), int(count)
dur = float(dur); strict = strict == "1"

if stats.get("error"):
    print(json.dumps({"asset": asset, "error": stats["error"], "verdict": "fail"})); raise SystemExit

fail, warn = [], []
if stats["max_alpha"] < 8:
    fail.append("no visible alpha in any frame")
if stats["peak_coverage_pct"] < 0.02:
    fail.append(f"peak coverage {stats['peak_coverage_pct']}% is effectively empty")
if stats["peak_frame"] == 0:
    warn.append("alpha peaks on frame 0; check the animation starts where you think")
if stats["last_frame_max_alpha"] >= 8:
    msg = f"last frame still carries alpha (max {stats['last_frame_max_alpha']}); the fade does not finish"
    (fail if strict else warn).append(msg)

verdict = "fail" if fail else ("warn" if warn else "pass")
print(json.dumps({
    "asset": asset,
    "source": src or None,
    "export": {"path": os.path.abspath(target), "kind": kind, "codec": codec, "pix_fmt": pix,
               "width": w, "height": h, "fps": fps, "frames": stats["frames"],
               "duration_s": round(stats["frames"] / fps, 4), "bytes": None},
    "alpha": stats,
    "verdict": verdict,
    "issues": fail + warn,
}))
PY
)"

# Merge the entry into the manifest, replacing any earlier entry for the same file.
MANIFEST_PATH="${OUT:-}"
if [ -z "$MANIFEST_PATH" ]; then
  if [ -d "$TARGET" ]; then MANIFEST_PATH="$(dirname "$TARGET")/manifest.json"
  else MANIFEST_PATH="$(dirname "$TARGET")/manifest.json"; fi
fi

"$PY" - "$MANIFEST_PATH" "$MANIFEST" "$TARGET" "$SRC" <<'PY'
import json, os, sys, hashlib, datetime
path, entry_s, target, src = sys.argv[1:5]
entry = json.loads(entry_s)

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def size_of(p):
    if os.path.isdir(p):
        return sum(os.path.getsize(os.path.join(p, f)) for f in os.listdir(p) if os.path.isfile(os.path.join(p, f)))
    return os.path.getsize(p)

if entry.get("export"):
    entry["export"]["bytes"] = size_of(target)
    entry["export"]["sha256"] = (sha256(target) if os.path.isfile(target)
                                 else "dir:" + hashlib.sha256(
                                     "".join(sorted(f for f in os.listdir(target))).encode()).hexdigest())

manifest = {"asset": entry.get("asset"), "tool": {}, "exports": [], "verdict": "pass"}
if os.path.exists(path):
    try:
        manifest = json.load(open(path))
    except json.JSONDecodeError:
        pass
manifest.setdefault("exports", [])
manifest["asset"] = entry.get("asset") or manifest.get("asset")
if src:
    manifest["source"] = src
manifest["tool"] = {"name": "effectcraft", "version": os.environ.get("EFFECTCRAFT_VERSION") or None}
manifest["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

if entry.get("export"):
    key = entry["export"]["path"]
    kept = [e for e in manifest["exports"] if (e.get("export") or {}).get("path") != key]
    kept.append(entry)
    manifest["exports"] = kept
verdicts = [e.get("verdict", "fail") for e in manifest["exports"]]
manifest["verdict"] = "fail" if "fail" in verdicts else ("warn" if "warn" in verdicts else "pass")

os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
with open(path, "w") as f:
    json.dump(manifest, f, indent=2, sort_keys=False)
    f.write("\n")
print(path)
PY

if [ "$JSON_OUT" = "1" ]; then
  printf '%s\n' "$MANIFEST"
else
  "$PY" - "$MANIFEST_PATH" "$TARGET" <<'PY'
import json, os, sys
path, target = sys.argv[1], os.path.abspath(sys.argv[2])
m = json.load(open(path))
entry = next((e for e in m.get("exports", []) if (e.get("export") or {}).get("path") == target), {})
e = entry.get("export") or {}
a = entry.get("alpha") or {}
print(f"asset      {m.get('asset')}")
print(f"export     {e.get('kind')} {e.get('codec')}/{e.get('pix_fmt')} {e.get('width')}x{e.get('height')} "
      f"{e.get('frames')}f @{e.get('fps')}fps {e.get('duration_s')}s {e.get('bytes')}B")
print(f"alpha      max {a.get('max_alpha')}  peak {a.get('peak_coverage_pct')}% @ frame {a.get('peak_frame')} "
      f"({a.get('peak_time_s')}s)  last {a.get('last_frame_coverage_pct')}%  dead {a.get('dead_after_s')}")
print(f"verdict    {entry.get('verdict')}")
for i in entry.get("issues") or []:
    print(f"  - {i}")
PY
fi

"$PY" - "$MANIFEST_PATH" "$TARGET" <<'PY'
import json, os, sys
m = json.load(open(sys.argv[1]))
target = os.path.abspath(sys.argv[2])
entry = next((e for e in m.get("exports", []) if (e.get("export") or {}).get("path") == target), {})
sys.exit(0 if entry.get("verdict") != "fail" else 1)
PY
