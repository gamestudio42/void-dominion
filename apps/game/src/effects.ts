import { buildingDef, unitDef } from '@void-dominion/content';
import { canSee, type World } from '@void-dominion/simulation';
import type { EffectSheet } from '@void-dominion/view3d';

export type EffectKind = 'muzzle_flash' | 'impact_hit' | 'explosion';

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
}

/**
 * Reads combat out of two consecutive world states, for one viewer. The
 * simulation keeps no shot events, so a shot is a cooldown reset, a hit is lost
 * hp, and a death is an entity that left the world. Only cells the viewer sees
 * produce an effect. Nothing here writes to the world.
 */
export function combatWatcher(viewer: number): (world: World) => CombatEffect[] {
  let last = new Map<number, Seen>();
  return (world) => {
    const next = new Map<number, Seen>();
    const effects: CombatEffect[] = [];
    const sees = (x: number, y: number) => canSee(world, viewer, Math.floor(x), Math.floor(y));
    for (const unit of world.units) {
      const def = unitDef(unit.kind);
      const now: Seen = { x: unit.x, y: unit.y, hp: unit.hp, cooldown: unit.cooldown, width: 0, height: 0 };
      next.set(unit.id, now);
      const before = last.get(unit.id);
      if (!before || !sees(unit.x, unit.y)) continue;
      if (def.damage > 0 && unit.cooldown === def.cooldown && before.cooldown !== def.cooldown) {
        effects.push({ kind: 'muzzle_flash', x: unit.x, y: unit.y, height: 0.55, size: 1.0 });
      }
      if (unit.hp < before.hp) effects.push({ kind: 'impact_hit', x: unit.x, y: unit.y, height: 0.45, size: 1.6 });
    }
    for (const building of world.buildings) {
      const def = buildingDef(building.kind);
      const x = building.x + def.width / 2;
      const y = building.y + def.height / 2;
      const now: Seen = { x, y, hp: building.hp, cooldown: building.cooldown, width: def.width, height: def.height };
      next.set(building.id, now);
      const before = last.get(building.id);
      if (!before || !sees(x, y)) continue;
      if (def.damage > 0 && building.cooldown === def.cooldown && before.cooldown !== def.cooldown) {
        effects.push({ kind: 'muzzle_flash', x, y, height: 1.3, size: 1.3 });
      }
      if (building.hp < before.hp) effects.push({ kind: 'impact_hit', x, y, height: 0.9, size: 2.2 });
    }
    for (const [id, gone] of last) {
      if (next.has(id) || !sees(gone.x, gone.y)) continue;
      const span = gone.width > 0 ? Math.max(gone.width, gone.height) * 1.3 : 2.2;
      effects.push({ kind: 'explosion', x: gone.x, y: gone.y, height: gone.width > 0 ? 0.9 : 0.5, size: span });
    }
    last = next;
    return effects;
  };
}
