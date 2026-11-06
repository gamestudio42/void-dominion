import { buildingDef, unitDef } from '@void-dominion/content';
import { canSee, type World } from '@void-dominion/simulation';
import type { EffectSheet } from '@void-dominion/view3d';

export type EffectKind = 'muzzle_flash' | 'impact_hit' | 'explosion' | 'build_complete' | 'ore_delivered';

/**
 * Verified EffectCraft renders, packed into sheets of 128 px cells. The layout
 * matches the `sheet` block of each manifest under assets/vfx/<kind>/.
 */
function sheet(kind: EffectKind, columns: number, rows: number, frames: number): EffectSheet {
  return { url: new URL(`../../../assets/vfx/${kind}/sheet.png`, import.meta.url).href, columns, rows, frames, fps: 30 };
}

export const EFFECT_SHEETS: Readonly<Record<EffectKind, EffectSheet>> = {
  muzzle_flash: sheet('muzzle_flash', 4, 2, 8),
  impact_hit: sheet('impact_hit', 4, 4, 14),
  explosion: sheet('explosion', 6, 5, 29),
  build_complete: sheet('build_complete', 6, 4, 24),
  ore_delivered: sheet('ore_delivered', 4, 3, 12),
};

export interface CombatEffect {
  kind: EffectKind;
  x: number;
  y: number;
  /** Height above the ground, in cells. */
  height: number;
  /** Sprite width, in cells. */
  size: number;
}

interface Seen {
  x: number;
  y: number;
  hp: number;
  cooldown: number;
  /** Footprint for a building, 0 for a unit. */
  width: number;
  height: number;
  /** Construction ticks so far; 0 for a unit. */
  progress: number;
  /** Ore a unit carries; 0 for a building. */
  carryOre: number;
}

/** The build_complete ring sits this far below the sprite centre, as a share of its width. */
const GROUND_RING = 0.22;
/** The ore_delivered ring sits this far below the sprite centre, as a share of its width. */
const ORE_RING = 0.16;
const ORE_SIZE = 1.4;
/** Deliveries this close in ticks and in the same 3-cell block play one pulse, so a busy depot does not flicker. */
const ORE_GAP_TICKS = 10;
const ORE_BLOCK = 3;

/**
 * Reads combat and production out of two consecutive world states, for one viewer.
 * The simulation keeps no shot events, so a shot is a cooldown that went up (it only
 * rises when a weapon fires, so this holds across a guest's two-tick views), a hit
 * is lost hp, and a death is an entity that left the world. A building that reached
 * its build ticks, or a new unit of the viewer's, plays build_complete; another
 * owner's unit can appear by walking into sight, so only the viewer's own count.
 * A unit of the viewer's whose carried ore dropped to zero delivered it: that plays
 * ore_delivered, at most once per block of cells every few ticks. Only cells the viewer sees produce an effect. Nothing here writes to the world.
 */
export function combatWatcher(viewer: number): (world: World, dead?: ReadonlySet<number>) => CombatEffect[] {
  let last = new Map<number, Seen>();
  let first = true;
  const lastPulse = new Map<number, number>();
  /** `dead`, when given, names the entities that died: a guest's world loses a unit that walks out of sight too. */
  return (world, dead) => {
    const next = new Map<number, Seen>();
    const effects: CombatEffect[] = [];
    const sees = (x: number, y: number) => canSee(world, viewer, Math.floor(x), Math.floor(y));
    for (const unit of world.units) {
      const def = unitDef(unit.kind);
      const now: Seen = { x: unit.x, y: unit.y, hp: unit.hp, cooldown: unit.cooldown, width: 0, height: 0, progress: 0, carryOre: unit.carryOre };
      next.set(unit.id, now);
      const before = last.get(unit.id);
      if (!sees(unit.x, unit.y)) continue;
      if (!before) {
        if (!first && unit.owner === viewer) {
          effects.push({ kind: 'build_complete', x: unit.x, y: unit.y, height: 1.6 * GROUND_RING, size: 1.6 });
        }
        continue;
      }
      if (def.damage > 0 && unit.cooldown > before.cooldown) {
        effects.push({ kind: 'muzzle_flash', x: unit.x, y: unit.y, height: 0.55, size: 1.0 });
      }
      if (unit.hp < before.hp) effects.push({ kind: 'impact_hit', x: unit.x, y: unit.y, height: 0.45, size: 1.6 });
      if (unit.owner === viewer && before.carryOre > 0 && unit.carryOre === 0) {
        const block = Math.floor(unit.y / ORE_BLOCK) * 4096 + Math.floor(unit.x / ORE_BLOCK);
        const at = lastPulse.get(block);
        if (at === undefined || world.tick - at >= ORE_GAP_TICKS) {
          lastPulse.set(block, world.tick);
          effects.push({ kind: 'ore_delivered', x: unit.x, y: unit.y, height: ORE_SIZE * ORE_RING, size: ORE_SIZE });
        }
      }
    }
    for (const building of world.buildings) {
      const def = buildingDef(building.kind);
      const x = building.x + def.width / 2;
      const y = building.y + def.height / 2;
      const now: Seen = { x, y, hp: building.hp, cooldown: building.cooldown, width: def.width, height: def.height, progress: building.progress, carryOre: 0 };
      next.set(building.id, now);
      const before = last.get(building.id);
      if (!before || !sees(x, y)) continue;
      if (before.progress < def.buildTicks && building.progress >= def.buildTicks) {
        const span = Math.max(def.width, def.height) * 1.3;
        effects.push({ kind: 'build_complete', x, y, height: span * GROUND_RING, size: span });
      }
      if (def.damage > 0 && building.cooldown > before.cooldown) {
        effects.push({ kind: 'muzzle_flash', x, y, height: 1.3, size: 1.3 });
      }
      if (building.hp < before.hp) effects.push({ kind: 'impact_hit', x, y, height: 0.9, size: 2.2 });
    }
    for (const [id, gone] of last) {
      if (next.has(id) || !sees(gone.x, gone.y) || (dead && !dead.has(id))) continue;
      const span = gone.width > 0 ? Math.max(gone.width, gone.height) * 1.3 : 2.2;
      effects.push({ kind: 'explosion', x: gone.x, y: gone.y, height: gone.width > 0 ? 0.9 : 0.5, size: span });
    }
    last = next;
    first = false;
    return effects;
  };
}
