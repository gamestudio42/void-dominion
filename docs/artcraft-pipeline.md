# ArtCraft asset pipeline

How generated 2D art (VFX, HUD/UI animation, sprites, textures) enters this
game. The apps are ArtCraft's Rust desktop suite, driven headlessly through
`<app>-cli` or through the EffectCraft MCP server — no window has to be open.

Measured on this machine: EffectCraft 0.21.0, PhotoCraft 0.20.1, ffmpeg 9.0.1,
no GPU, no display.

Agent rules live in `.cursor/rules/artcraft-assets.mdc` (always applied) and
`.cursor/rules/effectcraft-playbook.mdc` (recipes, loaded when touching
`assets/**` or `tools/asset-pipeline/**`). This document is the convention;
the rule is the enforcement.

## Which app, for what

| App | Use it for | Status here |
|---|---|---|
| `effectcraft-cli` 0.21.0 | VFX, HUD/UI animation, particles, title cards, Lottie. The only app that exports engine-consumable alpha | install + MCP ready |
| `photocraft-cli` 0.20.1 | Batch 2D: resize, convert, PSD round-trip, contact sheets | on disk, not on PATH |
| `gridcraft-cli` 0.16.0 | Economy tables, drop tables, asset sheets | on disk, not on PATH |
| `soundcraft-cli` 0.17.0 | DAW — no headless bounce works in 0.17.0 | interactive only |
| `texturecraft` / `materialcraft` | 3D texture painting, PBR materials | too early, do not build on them |

The suite has **no 3D DCC, no engine, no level design, no pixel-art animator**.
Blender and the engine cover those; see `docs/blender-pipeline.md` for the mesh
side, and do not stretch EffectCraft into them.

## Directory contract

```
assets/_staging/<asset>/                  machine-local, gitignored
  <asset>.ecproj                          source of truth, produced by --build
  <asset>.webm                            review artifact (VP9 + alpha)
  frames/f_00000.png …                    delivery artifact (RGBA sequence)
  manifest.json                           what was verified, with sha256
assets/vfx/<asset>/                       shipped copy, committed
  frames/ …  manifest.json
```

Rules:

- Renders never land directly in `assets/vfx/`, `res://`, or any path the engine
  imports. Staging first, copy after `verify_export.sh` passes.
- The `.ecproj` and the `*.build.json` recipe are the source of truth. A render
  is a build artifact, reproducible from them.
- One directory per asset name. Variants are seed folders (`<asset>/seed_1234/`)
  or suffixes (`impact_hit_a`), never "final", "final2", "v2-new".
- `assets/_staging/` is gitignored; `assets/vfx/` is not.

## Build → render → verify

```bash
# Whole pipeline for one asset (build recipe → sequence + preview → manifest)
tools/asset-pipeline/bake.sh --asset impact_hit --comp impact_burst \
  --build tools/asset-pipeline/examples/impact_burst.build.json \
  --duration 0.6 --fps 30

# Prove the toolchain itself before trusting it with real art
tools/asset-pipeline/selftest.sh

# Verify any export by hand (sequence dir, still, or alpha video)
tools/asset-pipeline/verify_export.sh assets/_staging/impact_hit/frames \
  --asset impact_hit --fps 30
```

`bake.sh` exits non-zero when verification fails. Do not copy anything into the
game when it fails.

## Manifest

Written by `verify_export.sh`, merged per exported file. This is a real entry
(320×320, 18 frames, 0.6 s at 30 fps):

```json
{
  "asset": "impact_hit",
  "tool": { "name": "effectcraft", "version": "0.21.0" },
  "exports": [
    {
      "export": {
        "path": ".../frames", "kind": "sequence", "codec": "png", "pix_fmt": "rgba",
        "width": 320, "height": 320, "fps": 30.0, "frames": 18,
        "duration_s": 0.6, "bytes": 128640, "sha256": "dir:d8ff07…"
      },
      "alpha": {
        "max_alpha": 255, "visible_frames": 16,
        "peak_frame": 5, "peak_time_s": 0.1667, "peak_coverage_pct": 1.8369,
        "last_frame_max_alpha": 2, "last_frame_coverage_pct": 0.0,
        "dead_after_s": 0.5667
      },
      "verdict": "pass", "issues": []
    }
  ],
  "verdict": "pass"
}
```

`verdict` is `pass`, `warn` (usable, but something is off — e.g. the fade never
reaches zero) or `fail` (no visible alpha / effectively empty). Only `pass` and
`warn` may be shipped, and a `warn` has to be reported to the user, not silenced.

## Engine delivery

**PNG sequence is the asset. Alpha video is the preview.** Measured on Godot
4.7.2: there is no `VideoStreamWebm`, and converting WebM → OGV drops the alpha
plane, so a video never carries transparency into a Godot project.

**This repository is a Three.js client, not a Godot project.** Ship a verified
PNG sequence (or a sheet packed from it) and load those frames from the web
client. Do not add `res://` paths or `SpriteFrames` here. The Godot notes below
stay as measurements of the tool, for games that still use that engine.

| Target | Deliver | Note |
|---|---|---|
| Godot 4 | `frames/f_%05d.png` (RGBA) → `SpriteFrames` / `AnimatedSprite2D`, or an atlas packed by the engine | Build `SpriteFrames` at runtime from `ResourceLoader.exists()` paths, not a 30-line `.tres` |
| Web / canvas | PNG sprite sheet, or WebM VP9 with alpha (Chromium decodes it; Firefox/Safari do not) | Keep the PNG as fallback |
| NLE / trailer | ProRes 4444 (`yuva444p12le`) | Convert to 8-bit alpha before any engine import |

Export/PCK trap: `DirAccess` over `res://` breaks in an exported Godot project
(files are listed as `.import`/`.remap`), so a `*.png` filter matches nothing.
Build paths and test `ResourceLoader.exists()` instead, and keep a `-- --verify`
flag reachable from the shipped binary.

## Version pinning

ArtCraft ships releases weekly and command ids drift. `bake.sh` records
`effectcraft-cli --version` in the manifest; after any upgrade re-run
`effectcraft-cli commands` and `tools/asset-pipeline/selftest.sh` before
re-baking a shipped asset.

## MCP (optional, for interactive comp work)

`.cursor/mcp.json` registers the EffectCraft server with
`--automation-write-root assets/_staging`, so the agent can write only inside
staging. Tools appear as `mcp_effectcraft_*` (27 of them). Prefer
`describe_command` before `execute_command` — it returns the param schema.
Keep MCP for poking at a comp; use the CLI + scripts for anything repeatable,
because the CLI path is the one that gets verified.

## Reporting

Report in English, numbers over adjectives: app version, what was built and
rendered, measured alpha (peak coverage, peak time, time to zero), file sizes,
and the manifest path. Say plainly what was not run. A render that "completed
successfully" is not evidence — the manifest is.
