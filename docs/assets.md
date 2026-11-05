# Assets

No third-party art, audio or fonts are shipped.

The boot screen, buildings, nodes and rocks are drawn by code. Colour is a material, not a texture from another game.

## Shipped

| Asset | Path | Source | License |
| --- | --- | --- | --- |
| Unit meshes: engineer, rifleman, rocketeer, scout_rover, assault_walker | `assets/models/<kind>/` | Generated from `tools/asset-pipeline/blender/specs/<kind>.json` by `bake_mesh.sh` (Blender 5.2.2). Primitives only, no imported art. | Original, same as the code: AGPL-3.0-or-later |

Each folder holds the `.glb`, the `manifest.json` written by `verify_glb.py` (verdict `pass`, triangles, sha256) and the `atlas.png` turntable used for review. The palette entry `team` is recoloured by owner in the client. `packages/view3d/test/models.test.ts` checks every unit kind has a model, its hash matches the manifest, it carries `team` and stands on the ground.

## How art enters later

| Kind | Contract | Shipped path |
| --- | --- | --- |
| VFX, HUD animation, sprites | `docs/artcraft-pipeline.md` | `assets/vfx/<asset>/` after a passing manifest |
| Props, units, terrain chunks | `docs/blender-pipeline.md` | `assets/models/<asset>/` after `verify_glb.py` |

Renders are written to `assets/_staging/` first. That directory is gitignored. The scout ship JSON under `tools/asset-pipeline/blender/examples/` is a pipeline fixture, not a unit in this game.
