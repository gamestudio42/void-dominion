# Assets

No third-party art, audio or fonts are shipped.

The boot screen and, until a mesh is baked, the field units are drawn by code. Colour is a material or a flat fill, not a texture from another game.

## How art enters later

| Kind | Contract | Shipped path |
| --- | --- | --- |
| VFX, HUD animation, sprites | `docs/artcraft-pipeline.md` | `assets/vfx/<asset>/` after a passing manifest |
| Props, units, terrain chunks | `docs/blender-pipeline.md` | `assets/models/<asset>/` after `verify_glb.py` |

Renders are written to `assets/_staging/` first. That directory is gitignored. The scout ship JSON under `tools/asset-pipeline/blender/examples/` is a pipeline fixture, not a unit in this game.
