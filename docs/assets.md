# Assets

No third-party art, audio or fonts are shipped.

The boot screen and the placement preview are drawn by code. Colour is a material, not a texture from another game.

## Shipped

| Asset | Path | Source | License |
| --- | --- | --- | --- |
| Unit meshes: engineer, rifleman, rocketeer, scout_rover, assault_walker | `assets/models/<kind>/` | Generated from `tools/asset-pipeline/blender/specs/<kind>.json` by `bake_mesh.sh` (Blender 5.2.2). Primitives only, no imported art. | Original, same as the code: AGPL-3.0-or-later |
| Building meshes: command_center, ore_extractor, aether_refinery, power_generator, barracks, vehicle_factory, defense_turret | `assets/models/<kind>/` | Same pipeline and specs folder. Each spec is drawn in cells at 92% of the footprint in `packages/content`. | Original, same as the code: AGPL-3.0-or-later |
| Terrain meshes: ore_node, aether_node, rock, rock_spire | `assets/models/<kind>/` | Same pipeline and specs folder. Nodes fit one cell; the two boulders are two cells across and tile the rock rects. | Original, same as the code: AGPL-3.0-or-later |
| Combat VFX: muzzle_flash, impact_hit, explosion | `assets/vfx/<kind>/sheet.png` | Built from `tools/asset-pipeline/vfx/<kind>.build.json` by `bake.sh` (EffectCraft 0.21.1): shapes, CC Particle World, Turbulent Displace and Gaussian Blur, no imported art. The verified PNG sequence is scaled to 128 px cells and tiled into one sheet with ffmpeg. | Original, same as the code: AGPL-3.0-or-later |

Each folder holds the `.glb`, the `manifest.json` written by `verify_glb.py` (verdict `pass`, triangles, sha256) and the `atlas.png` turntable used for review. The palette entry `team` is recoloured by owner in the client. `packages/view3d/test/models.test.ts` checks every unit and building kind has a model, its hash matches the manifest, it carries `team` and stands on the ground, that each building spans 92% of its footprint, centred, and that nodes fit one cell and boulders two. `packages/view3d/test/effects.test.ts` checks each VFX manifest passed, the sheet hash and size match its `sheet` block, and the client reads the same layout.

## How art enters later

| Kind | Contract | Shipped path |
| --- | --- | --- |
| VFX, HUD animation, sprites | `docs/artcraft-pipeline.md` | `assets/vfx/<asset>/` after a passing manifest |
| Props, units, terrain chunks | `docs/blender-pipeline.md` | `assets/models/<asset>/` after `verify_glb.py` |

Renders are written to `assets/_staging/` first. That directory is gitignored. The scout ship JSON under `tools/asset-pipeline/blender/examples/` is a pipeline fixture, not a unit in this game.
