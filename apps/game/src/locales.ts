import type { BuildingKind, UnitKind } from '@void-dominion/content';

export const en = {
  selected: (count: number) => `${count} selected`,
  constructing: (name: string, percent: number) => `${name} ${percent}%`,
  blocked: 'Blocked',
  no_path: 'No path',
  out_of_bounds: 'Out of bounds',
  unknown_unit: 'Unknown unit',
  not_owner: 'Not yours',
  no_ore: 'Not enough ore',
  no_aether: 'Not enough aether',
  no_supply: 'Not enough supply',
  footprint: "Can't build there",
  no_refinery: 'Refinery required',
  not_visible: 'Not visible',
  cannot_produce: "Can't produce",
  not_engineer: 'Engineers only',
  own_target: 'That is yours',
  tick: (tick: number) => `Tick ${tick}`,
  fps: (fps: number) => `${fps} FPS`,
  ore: (amount: number) => `Ore ${amount}`,
  aether: (amount: number) => `Aether ${amount}`,
  supply: (used: number, cap: number) => `Supply ${used}/${cap}`,
  power: (give: number, take: number) => `Power ${give}/${take}`,
  stop: 'Stop',
  mine: 'Mine',
  attack: 'Attack',
  build: 'Build',
  save: 'Save replay',
  load: 'Load replay',
  replay_invalid: 'Replay unreadable',
  victory: 'Victory',
  defeat: 'Defeat',
  draw: 'Draw',
  contact: 'Contact',
  train: (name: string, ore: number, aether: number) => (aether > 0 ? `${name} ${ore}+${aether}` : `${name} ${ore}`),
  unitName: (kind: UnitKind) =>
    ({
      engineer: 'Engineer',
      rifleman: 'Rifleman',
      rocketeer: 'Rocketeer',
      scout_rover: 'Scout rover',
      assault_walker: 'Assault walker',
    })[kind],
  buildingName: (kind: BuildingKind) =>
    ({
      command_center: 'Command center',
      ore_extractor: 'Ore extractor',
      aether_refinery: 'Aether refinery',
      power_generator: 'Power generator',
      barracks: 'Barracks',
      vehicle_factory: 'Vehicle factory',
      defense_turret: 'Defense turret',
    })[kind],
};

export const ptBR: typeof en = {
  selected: (count: number) => (count === 1 ? '1 selecionada' : `${count} selecionadas`),
  constructing: (name: string, percent: number) => `${name} ${percent}%`,
  blocked: 'Bloqueado',
  no_path: 'Sem caminho',
  out_of_bounds: 'Fora do mapa',
  unknown_unit: 'Unidade desconhecida',
  not_owner: 'Não é sua',
  no_ore: 'Minério insuficiente',
  no_aether: 'Éter insuficiente',
  no_supply: 'Suprimento insuficiente',
  footprint: 'Não cabe aí',
  no_refinery: 'Precisa de refinaria',
  not_visible: 'Fora de visão',
  cannot_produce: 'Não pode produzir',
  not_engineer: 'Só engenheiros',
  own_target: 'Essa é sua',
  tick: (tick: number) => `Tick ${tick}`,
  fps: (fps: number) => `${fps} FPS`,
  ore: (amount: number) => `Minério ${amount}`,
  aether: (amount: number) => `Éter ${amount}`,
  supply: (used: number, cap: number) => `Suprimento ${used}/${cap}`,
  power: (give: number, take: number) => `Energia ${give}/${take}`,
  stop: 'Parar',
  mine: 'Minerar',
  attack: 'Atacar',
  build: 'Construir',
  save: 'Salvar replay',
  load: 'Carregar replay',
  replay_invalid: 'Replay ilegível',
  victory: 'Vitória',
  defeat: 'Derrota',
  draw: 'Empate',
  contact: 'Contato',
  train: (name: string, ore: number, aether: number) => (aether > 0 ? `${name} ${ore}+${aether}` : `${name} ${ore}`),
  unitName: (kind: UnitKind) =>
    ({
      engineer: 'Engenheiro',
      rifleman: 'Fuzileiro',
      rocketeer: 'Foguetista',
      scout_rover: 'Batedor',
      assault_walker: 'Andador de assalto',
    })[kind],
  buildingName: (kind: BuildingKind) =>
    ({
      command_center: 'Centro de comando',
      ore_extractor: 'Extrator de minério',
      aether_refinery: 'Refinaria de éter',
      power_generator: 'Gerador',
      barracks: 'Quartel',
      vehicle_factory: 'Fábrica de veículos',
      defense_turret: 'Torre de defesa',
    })[kind],
};

export type Messages = typeof en;

export function messagesFor(language: string): Messages {
  return language.toLowerCase().startsWith('pt') ? ptBR : en;
}

export function reasonText(messages: Messages, reason: string | null): string | null {
  if (!reason) return null;
  const table: Record<string, string> = {
    blocked: messages.blocked,
    no_path: messages.no_path,
    out_of_bounds: messages.out_of_bounds,
    unknown_unit: messages.unknown_unit,
    not_owner: messages.not_owner,
    no_ore: messages.no_ore,
    no_aether: messages.no_aether,
    no_supply: messages.no_supply,
    footprint: messages.footprint,
    no_refinery: messages.no_refinery,
    not_visible: messages.not_visible,
    cannot_produce: messages.cannot_produce,
    not_engineer: messages.not_engineer,
    own_target: messages.own_target,
  };
  return table[reason] ?? reason;
}
