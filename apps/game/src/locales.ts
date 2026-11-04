export const en = {
  selected: (count: number) => `${count} selected`,
  blocked: 'Blocked',
  no_path: 'No path',
  out_of_bounds: 'Out of bounds',
  unknown_unit: 'Unknown unit',
  not_owner: 'Not yours',
  tick: (tick: number) => `Tick ${tick}`,
  fps: (fps: number) => `${fps} FPS`,
};

export const ptBR: typeof en = {
  selected: (count: number) => (count === 1 ? '1 selecionada' : `${count} selecionadas`),
  blocked: 'Bloqueado',
  no_path: 'Sem caminho',
  out_of_bounds: 'Fora do mapa',
  unknown_unit: 'Unidade desconhecida',
  not_owner: 'Não é sua',
  tick: (tick: number) => `Tick ${tick}`,
  fps: (fps: number) => `${fps} FPS`,
};

export type Messages = typeof en;

export function messagesFor(language: string): Messages {
  return language.toLowerCase().startsWith('pt') ? ptBR : en;
}

export function reasonText(messages: Messages, reason: string | null): string | null {
  if (!reason) return null;
  if (reason === 'blocked') return messages.blocked;
  if (reason === 'no_path') return messages.no_path;
  if (reason === 'out_of_bounds') return messages.out_of_bounds;
  if (reason === 'unknown_unit') return messages.unknown_unit;
  if (reason === 'not_owner') return messages.not_owner;
  return reason;
}
