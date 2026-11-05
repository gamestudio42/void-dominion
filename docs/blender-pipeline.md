# Blender pipeline (low-poly meshes)

How 3D meshes enter the game. Blender runs **headless** — no window, no GPU
required — and every mesh is generated from a JSON spec that lives in the repo,
so the result is original, reviewable and reproducible.

Measured on this machine: Blender 5.2.2 LTS (snap), Python 3.13, CPU-only.
A 318-triangle ship spec plus eight Cycles turntable frames takes **4 s** end to
end.

## Which tool for which art

| Need | Tool | Pipeline |
|---|---|---|
| VFX, HUD/UI animation, sprites, textures | EffectCraft / PhotoCraft | `docs/artcraft-pipeline.md` |
| 3D props, ships, characters, terrain chunks | Blender (this doc) | `tools/asset-pipeline/blender/` |
| Engine scenes, materials, lighting | the engine | not generated |

## Directory contract

```
tools/asset-pipeline/blender/
  generate_lowpoly.py            spec → mesh → .glb (+ optional atlas)
  verify_glb.py                  reads the .glb itself, writes/merges manifest
  bake_mesh.sh                   generate → verify → review strip + GIF
  examples/scout_ship.json       pipeline fixture, not a game unit
  specs/<kind>.json              shipped Void Dominion units

assets/_staging/<asset>/         machine-local, gitignored
  <asset>.glb                     delivery artifact
  manifest.json                   what was verified (tris, bounds, sha256)
  frames/view_000.png …           review renders
  atlas.png, turntable.gif        review artifacts
assets/models/<asset>/           shipped copy, committed
```

## Orientation and scale contract

These are the rules the engine side may rely on:

- **Nose faces +Y in Blender**; with `export_yup` that becomes **−Z in glTF**,
  which is the forward axis in Godot and three.js. Do not rotate the mesh in
  the engine to fix a wrong export — fix the spec.
- **Longest side = `unit_scale`** (default 1.0 m) regardless of what the spec
  numbers are. Design in convenient units, let the normaliser make the size.
- **Origin at the world cursor** (0, 0, 0) — bbox centre, or the base when
  `"ground": true` (props, terrain chunks).
- **One mesh, one node**, flat shading, one material slot per palette entry.
  Split into more objects only when the engine needs separate meshes
  (turret, destruction pieces) and say so in the report.
- No textures. Colour comes from materials; UVs are not authored.

## Spec format

`generate_lowpoly.py` reads a JSON file; the full key list is in the script's
docstring. The important part is `scale` semantics, which differ per primitive:

| prim | `scale` means | params |
|---|---|---|
| `cube` | full dimensions `[x, y, z]` | — |
| `cylinder` | `[radius_x, radius_y, height]` | `vertices` |
| `cone` | `[radius_x, radius_y, height]` | `vertices`, `radius1`, `radius2` |
| `ico` | `[radius_x, radius_y, radius_z]` | `subdivisions` |
| `uv` | `[radius_x, radius_y, radius_z]` | `segments`, `rings` |
| `torus` | radius of the major ring, per axis | `minor_radius`, `major_segments`, `minor_segments` |

`"mirror": true` duplicates the part across X (wings, engines, fins). `bevel`
adds a chamfer and costs triangles — it is what separates "low-poly" from
"untextured boxes".

## Running it

```bash
# Full pipeline: generate → GLB → verify → atlas.png + turntable.gif
tools/asset-pipeline/blender/bake_mesh.sh \
  --spec tools/asset-pipeline/blender/examples/scout_ship.json

# Generator only, no renders
blender -b --factory-startup -P tools/asset-pipeline/blender/generate_lowpoly.py \
  -- --spec <spec.json> --out assets/_staging/<asset> --no-atlas

# Verify an existing file, by hand
python3 tools/asset-pipeline/blender/verify_glb.py assets/_staging/<asset>/<asset>.glb \
  --asset <asset> --max-tris 1500 --no-textures
```

`verify_glb.py` parses the GLB container (JSON chunk, accessors, materials,
images) — it does not trust the exporter's log. It fails on budget overrun,
more than one mesh node, embedded textures, a model that is not grounded when
`--ground` is given, or a file with no triangles.

## Budgets for low-poly (this game)

| Kind | Triangles | Notes |
|---|---|---|
| small prop / pickup | 150–400 | one material, no bevel or 1 bevel segment |
| ship / character | 300–1500 | 3–5 materials, beveled silhouette |
| billboard source | any | render 8 views at 256 px, pack with ffmpeg |

The scout ship reference spec lands at **318 tris, 4 materials, 28 KB GLB,
0.87 × 0.30 × 1.00 m**. Blender reports 183 mesh vertices; the GLB carries 684
because vertices split per material and normal — that difference is expected,
do not chase it.

## Review without a screen

An ASCII silhouette from the alpha channel catches the classic failure (camera
inside the model, black frames, asset not centred) without an image viewer:

```bash
ffmpeg -v error -y -i frames/view_000.png -f rawvideo -pix_fmt rgba /tmp/v.raw
python3 -c "b=open('/tmp/v.raw','rb').read();N=256;[print(''.join('#' if b[(y*N+x)*4+3]>200 else ' ' for x in range(0,N,4))) for y in range(0,N,7)]"
```

Keep `atlas.png` and `turntable.gif` in the manifest's folder for humans, and
quote the triangle count and bounds in the report — not "looks good".

## Pitfalls

- **`bpy` only exists inside Blender.** Host `python3` cannot import it; every
  generator runs through `blender -b -P`, never `python3 script.py`.
- **Always `--factory-startup`.** Otherwise the user's Blender preferences,
  add-ons and startup scene leak into a build that must be reproducible.
- **EEVEE Next is unreliable headless.** Use Cycles on CPU: `engine="CYCLES"`,
  `cycles.device="CPU"`, `film_transparent=True`, 16–24 samples is enough for a
  review atlas at 256 px.
- **Blender 5 renamed the emission sockets** (`Emission` → `Emission Color`
  plus `Emission Strength`). Guard with `if "Emission Color" in inputs`, or the
  script dies on 4.x/5.x differences.
- **Mirroring by negative scale inverts normals.** After applying, run
  `normals_make_consistent(inside=False)` or the part renders black inside-out.
- **`use_selection=True` on export** keeps the camera, the lights and the
  tracking empty out of the GLB.
- **A GLB is not a delivery until it is parsed.** Exporters happily write a
  file for an empty scene.

## Engine handoff

**This repository loads GLB files with Three.js.** Copy a verified
`assets/models/<asset>/<asset>.glb` into the web client. Do not rotate the mesh
in the client to fix a wrong export — the orientation contract above is the
fix. Keep `manifest.json` beside the shipped file. After a Blender upgrade,
re-bake and diff triangle count and bounds before replacing art.

`tools/asset-pipeline/blender/examples/scout_ship.json` proves the pipeline. It
is not a Helion unit and must not be spawned in a match.

Godot can import the same GLB, but this game does not run Godot:

```bash
godot --headless --path . --import        # other engines only
```

- Godot 4 imports `.glb` natively; the material colours survive, the emissive
  strength is clamped by the environment — re-check glow in the scene, not in
  the file.
- The PCK/`DirAccess` trap from `docs/artcraft-pipeline.md` applies to Godot
  exports only.
